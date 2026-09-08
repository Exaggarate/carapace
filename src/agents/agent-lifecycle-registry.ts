import crypto from "node:crypto";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { CarapaceConfig } from "../config/types.carapace.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { createAgentDeletionDatabaseCleanup } from "../state/agent-deletion-cleanup.js";
import {
  beginAgentDeletionJournal,
  claimCompletedAgentDeletionJournal,
  completeAgentDeletionJournalInDatabase,
  readAgentDeletionJournal,
  readAgentDeletionJournalInDatabase,
  removeAgentDeletionJournal,
  updateAgentDeletionJournalDatabasePaths,
  updateAgentDeletionJournalCleanupPaths,
  type AgentDeletionJournalCleanupPath,
  type AgentDeletionJournalEntry,
} from "../state/agent-deletion-journal.js";
import { readAgentProvenance, type AgentProvenance } from "../state/agent-provenance.js";
import { assertNoCarapaceAgentDatabaseLeases } from "../state/carapace-agent-db-lease.js";
import type {
  CarapaceStateDatabase,
  CarapaceStateDatabaseOptions,
} from "../state/carapace-state-db-contract.js";
import { runCarapaceStateWriteTransaction } from "../state/carapace-state-db.js";
import { resolveCarapaceStateSqlitePath } from "../state/carapace-state-db.paths.js";
import { withCarapaceStateLease } from "../state/carapace-state-lease.js";
import { resolveAgentConfig } from "./agent-scope-config.js";

export class AgentDeletionAuthorityRollbackError extends AggregateError {}

export class AgentDeletionCommitUncertainError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
  }
}

export type AgentLifecycleBinding = Readonly<{
  agentId: string;
  provenance: AgentProvenance | null;
}>;

type AgentDeletionInput = Omit<
  AgentDeletionJournalEntry,
  | "createdAt"
  | "operationId"
  | "cleanupCompleted"
  | "databasePaths"
  | "cleanupPaths"
  | "deleteFiles"
> & {
  databasePaths?: string[];
  cleanupPaths?: AgentDeletionJournalCleanupPath[];
  deleteFiles?: boolean;
};

export type AgentDeletionOperation = {
  entry: AgentDeletionJournalEntry;
  assertCurrent: (database?: CarapaceStateDatabase) => void;
  runDatabaseCleanup: ReturnType<typeof createAgentDeletionDatabaseCleanup>;
  fenceDatabasePaths: (paths: readonly string[]) => void;
  fenceCleanupPaths: (paths: readonly AgentDeletionJournalCleanupPath[]) => void;
  finish: () => void;
  completeInTransaction: (database: CarapaceStateDatabase) => void;
  rollback: () => void;
};

const log = createSubsystemLogger("agents/lifecycle");

/** Acquire before the config lock and retain ownership through cleanup and recovery. */
export function withAgentDeletion<T>(
  agentId: string,
  run: (begin: (entry: AgentDeletionInput) => AgentDeletionOperation) => Promise<T>,
  options: CarapaceStateDatabaseOptions = {},
): Promise<T> {
  const id = normalizeAgentId(agentId);
  const statePath = path.resolve(
    options.path ?? resolveCarapaceStateSqlitePath(options.env ?? process.env),
  );
  const stateOptions = { ...options, path: statePath, env: { ...(options.env ?? process.env) } };
  return withCarapaceStateLease(
    {
      scope: "core:agent-deletion",
      key: id,
      database: { scope: "shared", options: stateOptions },
      leaseMs: 60_000,
      waitMs: 5_000,
      // SQLite cleanup can block the event loop beyond the lease duration.
      heartbeat: "worker",
      leaseLabel: "agent deletion",
      operationLabel: "agent.deletion.lease",
    },
    async (lease) => {
      let begun = false;
      let closed = false;
      try {
        return await run((entry) => {
          if (closed || begun || normalizeAgentId(entry.agentId) !== id) {
            throw new Error(`Agent ${id} deletion already began or has a different target.`);
          }
          begun = true;
          const operationId = crypto.randomUUID();
          const journal = runCarapaceStateWriteTransaction((database) => {
            lease.assertOwnedInTransaction(database.db);
            return beginAgentDeletionJournal(
              { ...entry, agentId: id, operationId, deleteFiles: entry.deleteFiles !== false },
              stateOptions,
            );
          }, stateOptions);
          const assertJournal = (
            currentStatePath: string,
            entries: readonly Pick<
              AgentDeletionJournalEntry,
              "agentId" | "operationId" | "cleanupCompleted"
            >[],
            database?: CarapaceStateDatabase,
          ) => {
            if (
              closed ||
              path.resolve(currentStatePath) !== statePath ||
              !entries.some(
                (current) =>
                  current.agentId === id &&
                  current.operationId === operationId &&
                  !current.cleanupCompleted,
              )
            ) {
              throw new Error(`Agent ${id} deletion no longer owns database cleanup.`);
            }
            if (database) {
              lease.assertOwnedInTransaction(database.db);
            } else {
              lease.assertOwned();
            }
            return id;
          };
          const assertCurrent = (database?: CarapaceStateDatabase) => {
            const current = closed
              ? undefined
              : database
                ? readAgentDeletionJournalInDatabase(database, id)
                : readAgentDeletionJournal(id, stateOptions);
            assertJournal(database?.path ?? statePath, current ? [current] : [], database);
          };
          const mutateJournal = <Result>(mutate: () => Result): Result =>
            runCarapaceStateWriteTransaction((database) => {
              assertCurrent(database);
              return mutate();
            }, stateOptions);
          const completeInTransaction = (database: CarapaceStateDatabase) => {
            assertCurrent(database);
            if (!completeAgentDeletionJournalInDatabase(database, id, operationId)) {
              throw new Error(`Failed to complete deletion journal for agent ${id}.`);
            }
            closed = true;
          };
          return {
            entry: journal,
            assertCurrent,
            runDatabaseCleanup: createAgentDeletionDatabaseCleanup({
              statePath,
              assertAdmission: () => assertNoCarapaceAgentDatabaseLeases(id, stateOptions),
              assertCurrent,
              assertJournal,
              withCommit: (commit) => {
                let committed = false;
                try {
                  // Agent writers already acquire agent -> shared. Hold that order through
                  // COMMIT so an expired deletion cannot race a replacement owner.
                  mutateJournal(() => {
                    commit();
                    committed = true;
                  });
                } catch (error) {
                  if (!committed) {
                    throw error;
                  }
                  // Guard release cannot roll back durable agent rows or restore native bindings.
                  try {
                    log.warn("Agent deletion committed, but releasing its state guard failed", {
                      agentId: id,
                      error,
                    });
                  } catch {
                    // Diagnostics are also postcommit and cannot change the durable outcome.
                  }
                }
              },
            }),
            fenceDatabasePaths: (paths) =>
              mutateJournal(() => {
                if (
                  !updateAgentDeletionJournalDatabasePaths(id, operationId, paths, stateOptions)
                ) {
                  throw new Error(`Failed to fence database cleanup paths for agent ${id}.`);
                }
                journal.databasePaths = [
                  ...new Set(paths.map((entryPath) => path.resolve(entryPath))),
                ];
              }),
            fenceCleanupPaths: (paths) =>
              mutateJournal(() => {
                if (!updateAgentDeletionJournalCleanupPaths(id, operationId, paths, stateOptions)) {
                  throw new Error(`Failed to fence cleanup paths for agent ${id}.`);
                }
                journal.cleanupPaths = [...paths];
              }),
            completeInTransaction,
            finish: () => runCarapaceStateWriteTransaction(completeInTransaction, stateOptions),
            rollback: () =>
              mutateJournal(() => {
                if (!removeAgentDeletionJournal(id, operationId, stateOptions)) {
                  throw new Error(`Failed to roll back deletion journal for agent ${id}.`);
                }
                closed = true;
              }),
          };
        });
      } finally {
        closed = true;
      }
    },
  );
}

/** Atomically claim a completed deletion tombstone for a newly created identity. */
export function claimCompletedAgentDeletion(
  agentId: string,
  operationId: string,
  options: CarapaceStateDatabaseOptions = {},
): boolean {
  return claimCompletedAgentDeletionJournal(normalizeAgentId(agentId), operationId, options);
}

/** Return whether this process must refuse new authority for an agent id. */
export function isAgentDeletionBlocked(
  agentId: string,
  options: CarapaceStateDatabaseOptions = {},
): boolean {
  return Boolean(readAgentDeletionJournal(normalizeAgentId(agentId), options));
}

/** Captures the exact durable incarnation of an existing, deletion-safe agent. */
export function captureAgentLifecycleBinding(
  config: CarapaceConfig,
  agentId: string,
  options: CarapaceStateDatabaseOptions = {},
): AgentLifecycleBinding | undefined {
  const id = normalizeAgentId(agentId);
  if (!resolveAgentConfig(config, id) || isAgentDeletionBlocked(id, options)) {
    return undefined;
  }
  return Object.freeze({
    agentId: id,
    provenance: readAgentProvenance(id, options) ?? null,
  });
}

/** Revalidates an agent binding against both the roster and lifecycle owner. */
export function matchesAgentLifecycleBinding(
  config: CarapaceConfig,
  binding: AgentLifecycleBinding,
  options: CarapaceStateDatabaseOptions = {},
): boolean {
  const id = normalizeAgentId(binding.agentId);
  return (
    id === binding.agentId &&
    Boolean(resolveAgentConfig(config, id)) &&
    !isAgentDeletionBlocked(id, options) &&
    isDeepStrictEqual(readAgentProvenance(id, options) ?? null, binding.provenance)
  );
}

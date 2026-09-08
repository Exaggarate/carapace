import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { hasErrnoCode } from "../infra/errno.js";
import { clearNodeSqliteKyselyCacheForDatabase } from "../infra/kysely-sync-cache-state.js";
import {
  executeSqliteQuerySync,
  executeSqliteQueryTakeFirstSync,
  getNodeSqliteKysely,
} from "../infra/kysely-sync.js";
import { openNodeSqliteDatabase } from "../infra/node-sqlite.js";
import { runWithSqliteBusyTimeout } from "../infra/sqlite-busy-timeout.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { getFileLockProcessStartTime, isPidDefinitelyDead } from "../shared/pid-alive.js";
import {
  assertAgentDeletionPathFence,
  prepareAgentDeletionPathFence,
} from "./agent-deletion-journal.js";
import { carapaceStateDatabaseCache } from "./carapace-state-db-cache.js";
import type { CarapaceStateDatabaseOptions } from "./carapace-state-db-contract.js";
import { ensureAgentDatabaseLeaseSchema } from "./carapace-state-db-schema-additive.js";
import { tableExists } from "./carapace-state-db-schema-helpers.js";
import type { DB as CarapaceStateKyselyDatabase } from "./carapace-state-db.generated.js";
import {
  openCarapaceStateDatabase,
  runCarapaceStateWriteTransaction,
} from "./carapace-state-db.js";
import { resolveCarapaceStateSqlitePath } from "./carapace-state-db.paths.js";
import type { CarapaceStateLeaseContext } from "./carapace-state-lease.js";

type AgentDatabaseLeaseDatabase = Pick<
  CarapaceStateKyselyDatabase,
  "agent_database_leases" | "agent_deletion_journal" | "state_leases"
>;

export const AGENT_DATABASE_MAINTENANCE_LEASE = {
  scope: "core:agent-database-maintenance",
  key: "global",
} as const;

export class CarapaceAgentDatabaseLeaseActiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CarapaceAgentDatabaseLeaseActiveError";
  }
}

const maintenanceAuthority = new AsyncLocalStorage<CarapaceStateLeaseContext>();

export function runWithAgentDatabaseMaintenanceAuthority<T>(
  authority: CarapaceStateLeaseContext,
  run: () => Promise<T>,
): Promise<T> {
  return maintenanceAuthority.run(authority, run);
}

/** Revalidate the held lease, including immediately before committing a versioned rebuild. */
export function assertAgentDatabaseMaintenanceAuthority(
  expected?: CarapaceStateLeaseContext,
): void {
  const authority = maintenanceAuthority.getStore();
  if (!authority || (expected && authority !== expected)) {
    throw new Error(
      "Agent identity migration requires stopped-writer maintenance; stop active agents and run carapace doctor --fix.",
    );
  }
  authority.assertOwned();
}

/** Revalidate a maintenance owner when present, without requiring ordinary opens to hold one. */
export function assertAgentDatabaseMaintenanceAuthorityIfPresent(): void {
  maintenanceAuthority.getStore()?.assertOwned();
}

/** Verify the maintenance owner and its independent heartbeat before a synchronous phase. */
export function renewAgentDatabaseMaintenanceAuthorityIfPresent(): void {
  const authority = maintenanceAuthority.getStore();
  if (!authority) {
    return;
  }
  if (!authority.renew) {
    throw new Error("Agent database maintenance authority cannot renew its lease.");
  }
  authority.renew();
}

export function claimCarapaceAgentDatabaseLease(
  params: { agentId: string; path: string; env?: NodeJS.ProcessEnv },
  leaseId: string = crypto.randomUUID(),
): string {
  const agentId = normalizeAgentId(params.agentId);
  const deletionFence = prepareAgentDeletionPathFence(
    { agentId, path: params.path },
    { env: params.env },
  );
  const ownerStartTime = getFileLockProcessStartTime(process.pid);
  runCarapaceStateWriteTransaction(
    (database) => {
      ensureAgentDatabaseLeaseSchema(database.db);
      const db = getNodeSqliteKysely<AgentDatabaseLeaseDatabase>(database.db);
      const maintenance = executeSqliteQueryTakeFirstSync(
        database.db,
        db
          .selectFrom("state_leases")
          .select("owner")
          .where("scope", "=", AGENT_DATABASE_MAINTENANCE_LEASE.scope)
          .where("lease_key", "=", AGENT_DATABASE_MAINTENANCE_LEASE.key)
          .where("expires_at", ">", Date.now()),
      );
      if (maintenance) {
        throw new Error(
          "Agent database maintenance is in progress; retry after carapace doctor --fix completes.",
        );
      }
      assertAgentDeletionPathFence(database, deletionFence);
      executeSqliteQuerySync(
        database.db,
        db.insertInto("agent_database_leases").values({
          lease_id: leaseId,
          agent_id: agentId,
          path: params.path,
          owner_pid: process.pid,
          owner_start_time: ownerStartTime,
          opened_at: Date.now(),
        }),
      );
    },
    { env: params.env },
  );
  return leaseId;
}

export function releaseCarapaceAgentDatabaseLease(
  leaseId: string,
  options: CarapaceStateDatabaseOptions = {},
): void {
  runCarapaceStateWriteTransaction((database) => {
    ensureAgentDatabaseLeaseSchema(database.db);
    const db = getNodeSqliteKysely<AgentDatabaseLeaseDatabase>(database.db);
    executeSqliteQuerySync(
      database.db,
      db.deleteFrom("agent_database_leases").where("lease_id", "=", leaseId),
    );
  }, options);
}

/** An awaited open may consume its scan only while its original runtime claim survives. */
export function assertCarapaceAgentDatabaseLease(
  leaseId: string,
  params: { agentId: string; path: string; env?: NodeJS.ProcessEnv },
): void {
  const ownerStartTime = getFileLockProcessStartTime(process.pid);
  const database = openCarapaceStateDatabase({ env: params.env });
  const db = getNodeSqliteKysely<AgentDatabaseLeaseDatabase>(database.db);
  const held = executeSqliteQueryTakeFirstSync(
    database.db,
    db
      .selectFrom("agent_database_leases")
      .select(["agent_id", "path", "owner_pid", "owner_start_time"])
      .where("lease_id", "=", leaseId),
  );
  if (
    !held ||
    held.agent_id !== params.agentId ||
    held.path !== params.path ||
    held.owner_pid !== process.pid ||
    // Claims allow an unavailable start identity; only two known identities prove reuse.
    (held.owner_start_time !== null &&
      ownerStartTime !== null &&
      held.owner_start_time !== ownerStartTime)
  ) {
    throw new Error(`Agent database open lost its runtime lease: ${params.path}`);
  }
}

function readAgentDatabaseLeases(database: DatabaseSync) {
  const db = getNodeSqliteKysely<AgentDatabaseLeaseDatabase>(database);
  return executeSqliteQuerySync(
    database,
    db
      .selectFrom("agent_database_leases")
      .select(["agent_id", "lease_id", "owner_pid", "owner_start_time", "path"]),
  ).rows;
}

function isAgentDatabaseLeaseStale(row: {
  owner_pid: number;
  owner_start_time: number | null;
}): boolean {
  if (isPidDefinitelyDead(row.owner_pid)) {
    return true;
  }
  const currentStartTime = getFileLockProcessStartTime(row.owner_pid);
  return (
    row.owner_start_time !== null &&
    currentStartTime !== null &&
    row.owner_start_time !== currentStartTime
  );
}

/** Doctor holds both lifecycle coordinators before checking writers, without schema repair. */
export function assertNoCarapaceAgentDatabaseLeasesReadOnly(
  options: CarapaceStateDatabaseOptions = {},
): void {
  const pathname = path.resolve(options.path ?? resolveCarapaceStateSqlitePath(options.env));
  try {
    fs.statSync(pathname);
  } catch (error) {
    if (hasErrnoCode(error, "ENOENT")) {
      return;
    }
    throw error;
  }
  // Admission must also work after restoring a quarantined database. Runtime
  // readers reject that receipt before Doctor can verify and clear it.
  const cached = carapaceStateDatabaseCache.isCarapaceStateDatabaseOpen(pathname)
    ? carapaceStateDatabaseCache.getCarapaceStateDatabaseIfOpenAtPath(pathname)
    : undefined;
  const db = cached?.db ?? openNodeSqliteDatabase(pathname, { readOnly: true });
  try {
    runWithSqliteBusyTimeout(db, 250, () => {
      if (!tableExists(db, "agent_database_leases")) {
        return;
      }
      const owner = readAgentDatabaseLeases(db).find((row) => !isAgentDatabaseLeaseStale(row));
      if (owner) {
        throw new CarapaceAgentDatabaseLeaseActiveError(
          `Agent ${owner.agent_id} database is still open in process ${owner.owner_pid}; stop that process before Doctor repair.`,
        );
      }
    });
  } finally {
    if (!cached) {
      clearNodeSqliteKyselyCacheForDatabase(db);
      db.close();
    }
  }
}

export function assertNoCarapaceAgentDatabaseLeases(
  agentIdRaw: string | CarapaceStateLeaseContext,
  options: CarapaceStateDatabaseOptions = {},
): void {
  const maintenance = typeof agentIdRaw === "string" ? undefined : agentIdRaw;
  const agentId = typeof agentIdRaw === "string" ? normalizeAgentId(agentIdRaw) : undefined;
  const rows = runCarapaceStateWriteTransaction((database) => {
    maintenance?.assertOwnedInTransaction(database.db);
    ensureAgentDatabaseLeaseSchema(database.db);
    return readAgentDatabaseLeases(database.db);
  }, options);

  const staleLeaseIds = rows.filter(isAgentDatabaseLeaseStale).map((row) => row.lease_id);
  if (staleLeaseIds.length > 0) {
    runCarapaceStateWriteTransaction((database) => {
      maintenance?.assertOwnedInTransaction(database.db);
      ensureAgentDatabaseLeaseSchema(database.db);
      const db = getNodeSqliteKysely<AgentDatabaseLeaseDatabase>(database.db);
      executeSqliteQuerySync(
        database.db,
        db.deleteFrom("agent_database_leases").where("lease_id", "in", staleLeaseIds),
      );
    }, options);
  }
  const staleLeaseIdSet = new Set(staleLeaseIds);
  for (const row of rows) {
    if (staleLeaseIdSet.has(row.lease_id)) {
      continue;
    }
    const deletionFence = agentId
      ? prepareAgentDeletionPathFence(
          { agentId: row.agent_id, path: row.path, fenceAgentId: agentId },
          options,
        )
      : undefined;
    let leaseStillExists = false;
    runCarapaceStateWriteTransaction((database) => {
      maintenance?.assertOwnedInTransaction(database.db);
      ensureAgentDatabaseLeaseSchema(database.db);
      const db = getNodeSqliteKysely<AgentDatabaseLeaseDatabase>(database.db);
      leaseStillExists =
        executeSqliteQueryTakeFirstSync(
          database.db,
          db
            .selectFrom("agent_database_leases")
            .select("lease_id")
            .where("lease_id", "=", row.lease_id),
        ) !== undefined;
      if (leaseStillExists && row.agent_id !== agentId && deletionFence) {
        assertAgentDeletionPathFence(database, deletionFence);
      }
    }, options);
    if (leaseStillExists && (!agentId || row.agent_id === agentId)) {
      const remediation = agentId ? "." : "; stop that process and rerun carapace doctor --fix.";
      throw new CarapaceAgentDatabaseLeaseActiveError(
        `Agent ${row.agent_id} database is still open in another process${remediation}`,
      );
    }
  }
}

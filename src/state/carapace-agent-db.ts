// Carapace agent database stores agent-scoped persisted runtime state.
import { existsSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { resolveStateDir } from "../config/paths.js";
import { isGatewayExternallySupervised } from "../infra/gateway-supervision.js";
import { enableNodeSqliteKyselyStatementCache } from "../infra/kysely-sync.js";
import {
  openNodeSqliteDatabase,
  supportsNodeSqliteExtensionLoading,
} from "../infra/node-sqlite.js";
import type { SqliteFileGeneration } from "../infra/sqlite-file-generation.js";
import { quarantineOrphanedSqliteSidecars } from "../infra/sqlite-files.js";
import {
  confirmSqliteFileIntegrity,
  isTerminalSqliteIntegrityError,
  runSqliteIntegrityOperationSync,
  type SqliteIntegrityDiagnostics,
  type SqliteIntegrityOperation,
  type SqliteIntegrityConfirmation,
} from "../infra/sqlite-integrity.js";
import {
  deferSqlitePostCommitPublication,
  withSqlitePostCommitPublications,
} from "../infra/sqlite-post-commit.js";
import {
  runSqliteImmediateTransactionSync,
  type SqliteTransactionOptions,
} from "../infra/sqlite-transaction.js";
import { isSqliteSchemaVersionError } from "../infra/sqlite-user-version.js";
import {
  configureSqliteConnectionPragmas,
  configureSqlitePreSchemaPragmas,
  registerSqliteCacheExitClose,
  type SqliteWalMaintenance,
} from "../infra/sqlite-wal.js";
import { normalizeAgentId } from "../routing/session-key.js";
import {
  assertAgentDeletionCleanupAliases,
  assertAgentDeletionDatabaseCleanupAccess,
  getAgentDeletionDatabaseCleanup,
  registerAgentDeletionDatabaseCleanup,
} from "./agent-deletion-cleanup.js";
import { readAgentDeletionJournal } from "./agent-deletion-journal.js";
import { createCarapaceAgentDatabaseAdmissionOwner } from "./carapace-agent-db-admission.js";
import type {
  CarapaceAgentDatabase,
  CarapaceAgentDatabaseOptions,
} from "./carapace-agent-db-contract.js";
import { registerCarapaceAgentDatabaseIdentity } from "./carapace-agent-db-identity.js";
import {
  AGENT_DATABASE_MAINTENANCE_LEASE,
  assertNoCarapaceAgentDatabaseLeases,
  assertCarapaceAgentDatabaseLease,
  claimCarapaceAgentDatabaseLease,
  releaseCarapaceAgentDatabaseLease,
  runWithAgentDatabaseMaintenanceAuthority,
} from "./carapace-agent-db-lease.js";
import {
  agentDatabaseLifecycle as cache,
  startAgentDatabaseOpenTiming,
  closeCachedCarapaceAgentDatabase,
  closeCarapaceAgentDatabaseByPath,
  closeCarapaceAgentDatabases,
  closeCarapaceAgentDatabasesAsync,
  evictLruAgentDatabaseHandles,
  retainAgentDatabase,
  retainFailedAgentDatabaseClose,
  revokePendingAgentDatabaseOpen,
  type PendingAgentDatabaseOpen,
} from "./carapace-agent-db-lifecycle.js";
import { ensureCarapaceAgentDatabasePermissions } from "./carapace-agent-db-permissions.js";
import {
  isSameCarapaceAgentDatabasePath,
  registerCarapaceAgentDatabase,
  unregisterCarapaceAgentDatabase,
} from "./carapace-agent-db-registry.js";
import {
  assertCanonicalAgentPersistenceVersion,
  assertExistingAgentSchemaOwner,
  assertSupportedAgentSchemaVersion,
  readExistingAgentSchemaMeta,
} from "./carapace-agent-db-schema-helpers.js";
import {
  agentDatabaseIntegrityBeforeMutationSteps,
  ensureCarapaceAgentSchema,
} from "./carapace-agent-db-schema.js";
import {
  clearCarapaceAgentDatabaseValidationCache,
  getValidatedCarapaceAgentDatabaseOwner,
  invalidateCarapaceAgentDatabaseValidation,
  setValidatedCarapaceAgentDatabaseOwner,
} from "./carapace-agent-db-validation-cache.js";
import {
  isIncognitoCarapaceAgentSqlitePath,
  resolveCarapaceAgentSqlitePath,
} from "./carapace-agent-db.paths.js";
import {
  clearCarapaceDatabaseQuarantine,
  createCarapaceDatabaseVerificationError,
  readCarapaceDatabaseQuarantine,
} from "./carapace-quarantine-store.js";
import {
  CARAPACE_SQLITE_BUSY_TIMEOUT_MS,
  type CarapaceStateDatabaseOptions,
} from "./carapace-state-db.js";
import { withCarapaceStateLease, type CarapaceStateLeaseContext } from "./carapace-state-lease.js";

export {
  CARAPACE_AGENT_SCHEMA_VERSION,
  type CarapaceAgentDatabase,
  type CarapaceAgentDatabaseOptions,
  type CarapaceAgentDatabaseOwnerInspection,
  type CarapaceRegisteredAgentDatabase,
} from "./carapace-agent-db-contract.js";
export {
  assertCarapaceAgentDatabaseForMaintenance,
  migrateCarapaceAgentDatabaseForMaintenance,
} from "./carapace-agent-db-maintenance.js";
export { ensureCarapaceAgentDatabasePermissions } from "./carapace-agent-db-permissions.js";
export {
  listCarapaceRegisteredAgentDatabases,
  readCarapaceAgentDatabaseRegistryToken,
} from "./carapace-agent-db-registry.js";
export { ensureCarapaceAgentDatabaseSchema } from "./carapace-agent-db-schema.js";
export {
  isIncognitoCarapaceAgentSqlitePath,
  resolveIncognitoCarapaceAgentSqlitePath,
  resolveCarapaceAgentSqlitePath,
} from "./carapace-agent-db.paths.js";

export class IncognitoAgentDatabasePathCollisionError extends Error {
  readonly path: string;

  constructor(pathname: string) {
    super(
      `Incognito agent database sentinel path already exists: ${pathname}. This filename is reserved for in-memory incognito state; move or rename the file and retry.`,
    );
    this.name = "IncognitoAgentDatabasePathCollisionError";
    this.path = pathname;
  }
}

/** Reconfirm an advisory worker failure on the live owner connection. */
export function confirmCarapaceAgentDatabaseIntegrity(
  pathname: string,
): SqliteIntegrityConfirmation {
  const resolvedPath = path.resolve(pathname);
  closeCarapaceAgentDatabaseByPath(resolvedPath);
  // Closing breaks process ownership of the pathname. A replacement must
  // revalidate and claim its schema before the path can become trusted again.
  invalidateCarapaceAgentDatabaseValidation(resolvedPath);
  return confirmSqliteFileIntegrity(resolvedPath, resolvedPath);
}

/** Latch background verification damage so later opens fail without rescanning. */
export function recordCarapaceAgentDatabaseOpenFailure(
  pathname: string,
  error: Error,
  generation?: SqliteFileGeneration,
): boolean {
  const recorded = cache.terminal.record(pathname, error, generation);
  if (recorded) {
    // Quarantine revokes this process's trust because doctor may replace the file.
    invalidateCarapaceAgentDatabaseValidation(pathname);
  }
  return recorded;
}

/**
 * Clear a terminal open failure after doctor rewrites the database file.
 * Returns false when the persisted quarantine row survived; callers must
 * surface that, or the next open re-quarantines the repaired file.
 */
export function clearCarapaceAgentDatabaseOpenFailure(
  pathname: string,
  options: CarapaceStateDatabaseOptions = {},
): boolean {
  const resolvedPath = path.resolve(pathname);
  const cleared = clearCarapaceDatabaseQuarantine(resolvedPath, { env: options.env });
  cache.terminal.clear(resolvedPath);
  return cleared;
}

/** Open or return a cached per-agent database after schema and owner validation. */
export function openCarapaceAgentDatabase(
  options: CarapaceAgentDatabaseOptions,
): CarapaceAgentDatabase {
  return runSqliteIntegrityOperationSync(openCarapaceAgentDatabaseSteps(options));
}

export type { CarapaceAgentDatabaseWriteAdmission } from "./carapace-agent-db-admission.js";
export const { withCarapaceAgentDatabaseAsync, withCarapaceAgentDatabaseAdmission } =
  createCarapaceAgentDatabaseAdmissionOwner(openCarapaceAgentDatabaseSteps);

function* openCarapaceAgentDatabaseSteps(
  options: CarapaceAgentDatabaseOptions,
  pending?: PendingAgentDatabaseOpen,
): SqliteIntegrityOperation<CarapaceAgentDatabase> {
  const agentId = normalizeAgentId(options.agentId);
  const databaseOptions = { ...options, agentId };
  const pathname = resolveCarapaceAgentSqlitePath(databaseOptions);
  getAgentDeletionDatabaseCleanup(databaseOptions)?.assertCurrent();
  const incognito = isIncognitoCarapaceAgentSqlitePath(pathname, databaseOptions);
  // A live successful cache entry is authoritative; failed entries remain only for disposal.
  const opened = getCarapaceAgentDatabaseIfOpen(databaseOptions);
  if (opened) {
    cache.databases.delete(pathname);
    cache.databases.set(pathname, opened);
    return opened;
  }
  if (!pending) {
    revokePendingAgentDatabaseOpen(pathname);
  }
  const cached = cache.databases.get(pathname);
  const allowExtension = !process.permission && supportsNodeSqliteExtensionLoading();
  if (incognito) {
    // The sentinel has no reachable durable owner, so doctor cannot safely migrate a collision.
    // Refuse operator-created state instead of silently shadowing it with volatile writes.
    if (existsSync(pathname)) {
      throw new IncognitoAgentDatabasePathCollisionError(pathname);
    }
    if (cached) {
      closeCachedCarapaceAgentDatabase(cached);
      cache.databases.delete(pathname);
      cache.failures.delete(pathname);
    }
    // After the collision probe, this sentinel is only a cache key: SQLite opens :memory:,
    // and no directory, lease, registry row, WAL sidecar, or file write may be created.
    const db = openNodeSqliteDatabase(":memory:", { allowExtension });
    db.enableLoadExtension(false);
    configureSqlitePreSchemaPragmas(db, {
      busyTimeoutMs: CARAPACE_SQLITE_BUSY_TIMEOUT_MS,
    });
    const walMaintenance = configureSqliteConnectionPragmas(db, {
      busyTimeoutMs: CARAPACE_SQLITE_BUSY_TIMEOUT_MS,
      databaseLabel: `carapace-agent-incognito:${agentId}`,
      foreignKeys: true,
      synchronous: "NORMAL",
    });
    ensureCarapaceAgentSchema(db, agentId, pathname);
    registerCarapaceAgentDatabaseIdentity(db);
    const database = { agentId, db, path: pathname, walMaintenance };
    cache.incognito.add(database);
    cache.unregisterExitClose ??= registerSqliteCacheExitClose(closeCarapaceAgentDatabases);
    cache.databases.set(pathname, database);
    cache.generation += 1;
    return database;
  }
  quarantineOrphanedSqliteSidecars(pathname);
  // Latched paths are quarantined; every fresh open fails fast here until
  // doctor repairs the file and clears the latch plus the persisted row.
  const terminalFailure = cache.terminal.get(pathname);
  if (terminalFailure) {
    throw terminalFailure;
  }
  let persistedFailure: Error | undefined;
  try {
    const quarantine = readCarapaceDatabaseQuarantine(pathname, { env: databaseOptions.env });
    if (quarantine) {
      persistedFailure = createCarapaceDatabaseVerificationError(
        "agent",
        pathname,
        quarantine.reason,
      );
    }
  } catch {
    // A broken quarantine store must not brick every agent open.
    // The process latch and daily verifier still cover known damage.
  }
  if (persistedFailure) {
    recordCarapaceAgentDatabaseOpenFailure(pathname, persistedFailure);
    throw persistedFailure;
  }
  if (cached) {
    // A closed handle can leave Kysely and WAL helpers cached; clear both before reopening.
    closeCachedCarapaceAgentDatabase(cached);
    cache.databases.delete(pathname);
    cache.failures.delete(pathname);
  }
  // Lease release must retain its original state owner after ambient env changes.
  const leaseEnvironment = {
    CARAPACE_STATE_DIR: resolveStateDir(options.env ?? process.env),
    ...(isGatewayExternallySupervised(options.env ?? process.env)
      ? { CARAPACE_SUPERVISOR_MODE: "external" }
      : {}),
  };
  const leaseId = claimCarapaceAgentDatabaseLease({
    agentId,
    path: pathname,
    env: leaseEnvironment,
  });
  if (pending) {
    pending.assertHeld = () =>
      assertCarapaceAgentDatabaseLease(leaseId, {
        agentId,
        path: pathname,
        env: leaseEnvironment,
      });
  }
  const diagnostics: SqliteIntegrityDiagnostics = {};
  const finishPhase = startAgentDatabaseOpenTiming(
    agentId,
    pathname,
    pending ? "async" : "sync",
    diagnostics,
  );
  let openedDb: DatabaseSync | undefined;
  let openedDatabase: CarapaceAgentDatabase | undefined;
  let openedWalMaintenance: SqliteWalMaintenance | undefined;
  try {
    ensureCarapaceAgentDatabasePermissions(pathname, databaseOptions);
    // Free a slot before constructing the new handle: under real descriptor
    // pressure the 65th open would otherwise fail before eviction could run.
    evictLruAgentDatabaseHandles();
    // Ordinary agent state also works with SQLite builds that omit extensions.
    // Trusted borrowers may enable them only when both the runtime and permissions allow it.
    const db = openNodeSqliteDatabase(pathname, { allowExtension });
    db.enableLoadExtension(false);
    enableNodeSqliteKyselyStatementCache(db);
    openedDb = db;
    registerCarapaceAgentDatabaseIdentity(db);
    finishPhase("open");
    // Eviction churn must avoid migration/convergence and registry busy waits.
    // Version and owner can change while evicted, so their read-only gates run on every open.
    let isValidatedReopen = getValidatedCarapaceAgentDatabaseOwner(pathname) === agentId;
    const walMaintenance = yield* (function* (): SqliteIntegrityOperation<SqliteWalMaintenance> {
      let maintenance: CarapaceAgentDatabase["walMaintenance"] | undefined;
      try {
        db.exec(`PRAGMA busy_timeout = ${CARAPACE_SQLITE_BUSY_TIMEOUT_MS};`);
        assertSupportedAgentSchemaVersion(db, pathname);
        const existingSchema = readExistingAgentSchemaMeta(db);
        assertExistingAgentSchemaOwner(existingSchema, agentId, pathname);
        // Integrity is not process-stable: the file can be damaged while evicted.
        // This guard is read-only (no busy waits), so every physical open pays it.
        const requiresCurrentVersionConvergence = yield* agentDatabaseIntegrityBeforeMutationSteps(
          db,
          agentId,
          pathname,
          diagnostics,
        );
        if (isValidatedReopen && (!existingSchema || requiresCurrentVersionConvergence)) {
          // New files and same-version divergence cannot inherit an earlier validation.
          // The existing full path initializes or converges them before exposure.
          invalidateCarapaceAgentDatabaseValidation(pathname);
          isValidatedReopen = false;
        }
        assertCanonicalAgentPersistenceVersion(db, pathname);
        finishPhase("validation");
        configureSqlitePreSchemaPragmas(db, {
          busyTimeoutMs: CARAPACE_SQLITE_BUSY_TIMEOUT_MS,
        });
        maintenance = configureSqliteConnectionPragmas(db, {
          busyTimeoutMs: CARAPACE_SQLITE_BUSY_TIMEOUT_MS,
          databaseLabel: `carapace-agent:${agentId}`,
          databasePath: pathname,
          foreignKeys: true,
          synchronous: "NORMAL",
        });
        openedWalMaintenance = maintenance;
        finishPhase("configuration");
        if (!isValidatedReopen) {
          ensureCarapaceAgentSchema(db, agentId, pathname);
        }
        finishPhase("schema");
        return maintenance;
      } catch (err) {
        maintenance?.close();
        db.close();
        const current = cache.databases.get(pathname);
        if (!current || current.db === db) {
          invalidateCarapaceAgentDatabaseValidation(pathname);
        }
        if (
          err instanceof Error &&
          (isSqliteSchemaVersionError(err) || isTerminalSqliteIntegrityError(err))
        ) {
          recordCarapaceAgentDatabaseOpenFailure(pathname, err);
        }
        throw err;
      }
    })();
    // Concurrent admissions can fill the slot reserved before the native check.
    if (pending) {
      evictLruAgentDatabaseHandles();
    }
    ensureCarapaceAgentDatabasePermissions(pathname, databaseOptions);
    const database = { agentId, db, path: pathname, walMaintenance };
    openedDatabase = database;
    const cleanup = registerAgentDeletionDatabaseCleanup(database, databaseOptions);
    if (cleanup) {
      const release = retainAgentDatabase(db);
      cleanup.registerClose(() => {
        release();
        // The scope owns this connection, not a later cache entry at the same pathname.
        if (cache.databases.get(database.path) === database) {
          closeCarapaceAgentDatabaseByPath(database.path, database.agentId);
        } else if (database.db.isOpen) {
          throw new Error("Agent deletion cleanup lost its database close owner.");
        }
      });
    }
    if (!isValidatedReopen) {
      registerCarapaceAgentDatabase({ agentId, path: pathname, env: options.env });
      setValidatedCarapaceAgentDatabaseOwner(pathname, agentId);
    }
    cache.terminal.clear(pathname);
    // Safety net for processes that end without an orderly close: agent DBs have
    // no shutdown owner like the ACP/gateway state DB closes. Closing unregisters.
    cache.unregisterExitClose ??= registerSqliteCacheExitClose(closeCarapaceAgentDatabases);
    finishPhase("registration");
    cache.leases.set(pathname, { leaseId, env: leaseEnvironment });
    cache.databases.set(pathname, database);
    return database;
  } catch (error) {
    let closeError: unknown;
    if (openedDatabase) {
      try {
        closeCachedCarapaceAgentDatabase(openedDatabase);
      } catch (caught) {
        closeError = caught;
      }
    }
    if (openedDb?.isOpen) {
      if (
        pending &&
        cache.databases.has(pathname) &&
        cache.databases.get(pathname)?.db !== openedDb
      ) {
        // A synchronous opener may supersede pending work. Retain failed cleanup
        // with its original native owner; never overwrite the replacement cache/lease.
        const retainedDb = openedDb;
        retainFailedAgentDatabaseClose(agentId, pathname, () => {
          openedWalMaintenance?.close();
          if (retainedDb.isOpen) {
            retainedDb.close();
          }
          releaseCarapaceAgentDatabaseLease(leaseId, { env: leaseEnvironment });
        });
        throw error;
      }
      invalidateCarapaceAgentDatabaseValidation(pathname);
      const retainedDatabase =
        openedDatabase ??
        ({
          agentId,
          db: openedDb,
          path: pathname,
          walMaintenance: openedWalMaintenance ?? {
            checkpoint: () => false,
            close: () => false,
          },
        } satisfies CarapaceAgentDatabase);
      // Failed opens remain disposal-owned but cannot become successful cache hits.
      cache.databases.set(pathname, retainedDatabase);
      cache.leases.set(pathname, { leaseId, env: leaseEnvironment });
      cache.failures.set(pathname, closeError ?? error);
      cache.unregisterExitClose ??= registerSqliteCacheExitClose(closeCarapaceAgentDatabases);
    } else {
      try {
        releaseCarapaceAgentDatabaseLease(leaseId, { env: leaseEnvironment });
      } catch (releaseError) {
        retainFailedAgentDatabaseClose(agentId, pathname, () =>
          releaseCarapaceAgentDatabaseLease(leaseId, { env: leaseEnvironment }),
        );
        throw releaseError;
      }
    }
    throw closeError ?? error;
  }
}

/** Queue a non-throwing runtime publication on the outer database commit edge. */
export function deferCarapaceAgentPostCommitPublication(
  database: CarapaceAgentDatabase,
  publish: () => void,
): boolean {
  return deferSqlitePostCommitPublication(database.db, publish);
}

export function runCarapaceAgentWriteTransaction<T>(
  operation: (database: CarapaceAgentDatabase) => T,
  options: CarapaceAgentDatabaseOptions,
  transactionOptions: Pick<
    SqliteTransactionOptions,
    "busyTimeoutMs" | "operationLabel" | "slowTransactionHoldMs"
  > = {},
): T {
  const database = openCarapaceAgentDatabase(options);
  const enteredNestedTransaction = database.db.isTransaction;
  return withSqlitePostCommitPublications(database.db, () =>
    runSqliteImmediateTransactionSync(
      database.db,
      () => {
        assertAgentDeletionDatabaseCleanupAccess(database, options);
        const operationResult = operation(database);
        if (!enteredNestedTransaction && !cache.incognito.has(database)) {
          // Permission failure must roll back with the write. Repairing after
          // COMMIT could make callers retry a transaction already durable in SQLite.
          ensureCarapaceAgentDatabasePermissions(database.path, options);
        }
        return operationResult;
      },
      {
        busyTimeoutMs: transactionOptions.busyTimeoutMs ?? CARAPACE_SQLITE_BUSY_TIMEOUT_MS,
        databaseLabel: database.path,
        ...transactionOptions,
        operationLabel: transactionOptions.operationLabel ?? "agent.write",
        withCommit: getAgentDeletionDatabaseCleanup(options)?.withCommit,
      },
    ),
  );
}

/** Retain the exact verified connection across awaits; explicit disposal still revokes it. */
export function borrowCarapaceAgentDatabase(options: CarapaceAgentDatabaseOptions): {
  db: DatabaseSync;
  release: () => void;
} {
  const { db } = openCarapaceAgentDatabase(options);
  return { db, release: retainAgentDatabase(db) };
}

/** Return whether the exact cached agent database pathname is still open. */
export function isCarapaceAgentDatabaseOpen(pathname: string): boolean {
  return cache.databases.get(path.resolve(pathname))?.db.isOpen === true;
}

/** Return the matching live cache entry without materializing a database. */
export function getCarapaceAgentDatabaseIfOpen(
  options: CarapaceAgentDatabaseOptions,
): CarapaceAgentDatabase | undefined {
  const agentId = normalizeAgentId(options.agentId);
  const pathname = resolveCarapaceAgentSqlitePath({ ...options, agentId });
  // Incognito skips durable database leases, but still follows the agent deletion fence.
  if (
    isIncognitoCarapaceAgentSqlitePath(pathname, options) &&
    readAgentDeletionJournal(agentId, { env: options.env })
  ) {
    throw new Error(`Carapace agent database is unavailable while agent ${agentId} is deleted.`);
  }
  const database = cache.databases.get(pathname);
  if (!database?.db.isOpen) {
    assertAgentDeletionCleanupAliases(options, isSameCarapaceAgentDatabasePath);
    return undefined;
  }
  if (cache.failures.has(pathname)) {
    throw cache.failures.get(pathname);
  }
  if (database.agentId !== agentId) {
    throw new Error(
      `Carapace agent database ${pathname} is already open for agent ${database.agentId}; requested agent ${agentId}.`,
    );
  }
  assertAgentDeletionDatabaseCleanupAccess(database, options);
  return database;
}

/** Lists process-held incognito databases without opening new sentinel handles. */
export function listOpenIncognitoAgentDatabases(): Array<{ agentId: string; storePath: string }> {
  return [...cache.databases.values()]
    .filter((database) => database.db.isOpen && cache.incognito.has(database))
    .map((database) => ({ agentId: database.agentId, storePath: database.path }))
    .toSorted(
      (left, right) =>
        left.agentId.localeCompare(right.agentId) || left.storePath.localeCompare(right.storePath),
    );
}

/** Return the generation of process-held incognito database membership. */
export function readOpenIncognitoAgentDatabaseGeneration(): number {
  return cache.generation;
}

/** Returns whether this exact process-held database is incognito/in-memory. */
export function isIncognitoCarapaceAgentDatabase(database: CarapaceAgentDatabase): boolean {
  return cache.incognito.has(database);
}

/** List process-held agent databases without opening or inspecting fixture state. */
export function listCarapaceAgentDatabasesForTest(): Array<{ agentId: string; path: string }> {
  return [...cache.databases.values()]
    .filter((database) => database.db.isOpen)
    .map((database) => ({ agentId: database.agentId, path: database.path }))
    .toSorted(
      (left, right) =>
        left.agentId.localeCompare(right.agentId) || left.path.localeCompare(right.path),
    );
}

/** Close and unregister one unambiguous transient agent database by filesystem identity. */
export function disposeCarapaceAgentDatabaseByPath(
  pathname: string,
  options: { env?: NodeJS.ProcessEnv } = {},
): boolean {
  const resolvedPath = path.resolve(pathname);
  for (const pendingPath of cache.pending.keys()) {
    if (isSameCarapaceAgentDatabasePath(pendingPath, resolvedPath)) {
      revokePendingAgentDatabaseOpen(pendingPath);
    }
  }
  for (const retained of cache.retainedCloses) {
    if (isSameCarapaceAgentDatabasePath(retained.path, resolvedPath)) {
      retained.close();
    }
  }
  // Disposal can be followed by file deletion or recreation, so revalidate next open.
  invalidateCarapaceAgentDatabaseValidation(resolvedPath);
  const matchingDatabases = [...cache.databases.values()].filter((candidate) =>
    isSameCarapaceAgentDatabasePath(candidate.path, resolvedPath),
  );
  if (matchingDatabases.length > 1) {
    return false;
  }
  const database = matchingDatabases[0];
  if (database && cache.incognito.has(database)) {
    return closeCarapaceAgentDatabaseByPath(database.path);
  }
  if (!database) {
    return false;
  }
  try {
    unregisterCarapaceAgentDatabase({
      agentId: database.agentId,
      path: database.path,
      ...(options.env ? { env: options.env } : {}),
    });
  } finally {
    // Secret-bearing transient DBs must close even when registry maintenance
    // fails; Windows otherwise cannot remove the file during caller cleanup.
    closeCarapaceAgentDatabaseByPath(database.path);
  }
  return true;
}

/** Fence cross-process agent writers while Doctor reconciles shared plugin state. */
export function withAgentDatabaseMaintenanceLease<T>(
  options: Pick<CarapaceStateDatabaseOptions, "env">,
  run: (maintenance: CarapaceStateLeaseContext) => Promise<T>,
): Promise<T> {
  return withCarapaceStateLease(
    {
      ...AGENT_DATABASE_MAINTENANCE_LEASE,
      database: { scope: "shared", options },
      leaseMs: 60_000,
      waitMs: 5_000,
      heartbeat: "worker",
      leaseLabel: "agent database maintenance lease",
      operationLabel: "agent.database.maintenance.lease",
    },
    async (maintenance) => {
      // Claiming first closes the cross-process gap: every later writer claim
      // observes this same lease inside its authoritative state transaction.
      await closeCarapaceAgentDatabasesAsync();
      assertNoCarapaceAgentDatabaseLeases(maintenance, options);
      return runWithAgentDatabaseMaintenanceAuthority(maintenance, () => run(maintenance));
    },
  );
}

/** Release fixture handles and pathname trust before a test root is recreated. */
export function closeCarapaceAgentDatabasesForTest(rootPath?: string): void {
  closeCarapaceAgentDatabases(rootPath);
  clearCarapaceAgentDatabaseValidationCache(rootPath);
  cache.terminal.clearAll(rootPath);
}

export {
  CARAPACE_AGENT_DB_OPEN_HANDLE_CAP,
  closeCarapaceAgentDatabaseByPath,
  closeCarapaceAgentDatabases,
  closeCarapaceAgentDatabasesAsync,
  inspectCarapaceAgentDatabaseOwner,
  settleCarapaceAgentDatabaseWorkerClose,
  type CarapaceAgentDatabaseWorkerCloseResult,
} from "./carapace-agent-db-lifecycle.js";

// Carapace state database manages shared persisted state and migrations.
import { existsSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { clearNodeSqliteKyselyCacheForDatabase } from "../infra/kysely-sync.js";
import { openNodeSqliteDatabase } from "../infra/node-sqlite.js";
import {
  normalizeSqliteNonNegativeInteger,
  readSqliteBusyTimeout,
  runWithSqliteBusyTimeout,
  setSqliteBusyTimeout,
  type SqliteLockFailureReporting,
} from "../infra/sqlite-busy-timeout.js";
import { createSqliteLifecycleAggregateError } from "../infra/sqlite-coordinator.js";
import {
  repairCanonicalSqliteIndexes,
  verifyAndRepairCanonicalSqliteIndexes,
} from "../infra/sqlite-index-schema.js";
import {
  assertSqliteIntegrity,
  confirmSqliteFileIntegrity,
  type SqliteIntegrityConfirmation,
} from "../infra/sqlite-integrity.js";
import { withSqlitePostCommitPublications } from "../infra/sqlite-post-commit.js";
import { prepareSqliteReadOnlyLocation } from "../infra/sqlite-readonly-location.js";
import { assertSqliteSchemaTablesPresent } from "../infra/sqlite-schema-contract.js";
import { migrateSqliteSchemaToStrictInTransaction } from "../infra/sqlite-strict.js";
import {
  runSqliteImmediateTransactionSync,
  type SqliteTransactionOptions,
} from "../infra/sqlite-transaction.js";
import { readSqliteUserVersion } from "../infra/sqlite-user-version.js";
import {
  StateSchemaMutationConflictError,
  withStateSchemaFence,
} from "../infra/state-database-coordinator.js";
import { migrateLegacyCronRunLogsToTaskRuns } from "../infra/state-migrations.cron-run-logs.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { clearCarapaceDatabaseQuarantine } from "./carapace-quarantine-store.js";
import { repairAuditEventsSchema } from "./carapace-state-db-audit-migration.js";
import {
  carapaceStateDatabaseCache as stateDbCache,
  recordCarapaceStateDatabaseOpenFailure,
  clearCarapaceStateDatabaseOpenFailure,
  closeCarapaceStateDatabaseByPath,
} from "./carapace-state-db-cache.js";
import {
  CARAPACE_DATABASE_SCHEMA_DOCS_URL,
  LAZY_ADDITIVE_STATE_TABLES,
  CARAPACE_SQLITE_BUSY_TIMEOUT_MS,
  CARAPACE_STATE_SCHEMA_VERSION,
  CARAPACE_STATE_STRICT_SCHEMA_VERSION,
  type CarapaceStateDatabase,
  type CarapaceStateDatabaseOptions,
} from "./carapace-state-db-contract.js";
import {
  assertCurrentStateRuntimeSchema,
  isCarapaceStateSchemaFastPathEligible,
  needsCarapaceStateDatabaseSchemaRepair,
} from "./carapace-state-db-fast-path.js";
import {
  assertCarapaceStateDatabaseForMaintenance,
  markCurrentStateSchemaVersion,
  carapaceStateMigrationAssertions,
  resolveDatabasePath,
  versionedStateMigrations,
  runStateSchemaMigrationTransaction,
  writeCurrentStateSchemaMetadata,
  executeCanonicalStateSchema,
} from "./carapace-state-db-maintenance.js";
import { openUnpublishedStateDatabase } from "./carapace-state-db-open.js";
import * as operatorApprovalMigration from "./carapace-state-db-operator-approval-migration.js";
import { ensureCarapaceStatePermissions } from "./carapace-state-db-permissions.js";
import { withExistingCarapaceStateDatabaseReadOnly } from "./carapace-state-db-readonly.js";
import {
  ensureAdditiveStateColumns,
  ensureFirstUseAdditiveStateColumnsForStrictMigration,
} from "./carapace-state-db-schema-additive.js";
import { tableExists } from "./carapace-state-db-schema-helpers.js";
import {
  type AgentDatabasePathMigrationSummary as AgentPathSummary,
  assertCanonicalStateSchemaShape,
  dropLegacyStateTables,
  migrateAgentDatabaseRelativePaths as migrateAgentPaths,
  migrateWorkerPlacementExecutionModeSchema,
  repairAgentDatabasesCompositePrimaryKey,
  repairLegacyGatewayRestartHandoffsForStrictMigration,
} from "./carapace-state-db-schema-repair.js";
import { migrateSingletonStateFoldInV12 } from "./carapace-state-db-schema-v12-foldin.js";
import {
  assertSupportedStateSchemaVersion,
  readStateSchemaContentVersion,
} from "./carapace-state-db-schema-version.js";
import * as sessionWatchMigration from "./carapace-state-db-session-watch-migration.js";
import {
  initializeNativeCarapaceStateConnection,
  isUninitializedNativeStartupDatabase,
  withCarapaceStateStartupCheckpointConnection,
} from "./carapace-state-db-startup-checkpoint.js";
import * as retirements from "./carapace-state-db-table-retirements.js";
import { describeAgentPathMigration, warnAgentPathMigration } from "./carapace-state-db.paths.js";
import {
  assertCarapaceStateWriteAllowed,
  isCarapaceStateWriteContentionError,
  CarapaceStateOwnershipError,
  runWithCarapaceStateWriteAccess,
} from "./carapace-state-ownership.js";
import { getCarapaceStateRuntimeSchema } from "./carapace-state-schema-compatibility.js";
import {
  readStateSchemaPublicationBlocker,
  type StateSchemaPublicationBlocker,
} from "./carapace-state-schema-publication.js";
import { CARAPACE_STATE_SCHEMA_SQL } from "./carapace-state-schema.js";
import { UpdateSchemaRefusalError } from "./carapace-update-schema-refusal.js";
export { registerCarapaceStateDatabaseLifecycleListener } from "./carapace-state-db-cache.js";

export { CARAPACE_DATABASE_SCHEMA_DOCS_URL, CARAPACE_SQLITE_BUSY_TIMEOUT_MS };
export type {
  CarapaceStateDatabase,
  CarapaceStateDatabaseOptions,
  CarapaceStateDatabaseSchemaMigration,
} from "./carapace-state-db-contract.js";
export { assertCarapaceStateDatabaseForMaintenance } from "./carapace-state-db-maintenance.js";
export { ensureCarapaceStatePermissions } from "./carapace-state-db-permissions.js";
export { detectCarapaceStateDatabaseSchemaMigrations } from "./carapace-state-db-schema-repair.js";

/** Reconfirm an advisory worker failure on the live owner connection. */
export function confirmCarapaceStateDatabaseIntegrity(
  pathname: string,
): SqliteIntegrityConfirmation {
  const resolvedPath = path.resolve(pathname);
  closeCarapaceStateDatabaseByPath(resolvedPath);
  return confirmSqliteFileIntegrity(resolvedPath, resolvedPath);
}

/** Reject a fresh shared-state open after known corruption until repair clears it. */
function assertCarapaceStateDatabaseFreshOpenAllowed(
  options: CarapaceStateDatabaseOptions = {},
): void {
  const env = options.env ?? process.env;
  stateDbCache.assertCarapaceStateDatabaseFreshOpenAllowedAtPath(resolveDatabasePath(options), env);
}

const stateDbLog = createSubsystemLogger("state/db");
const deferredStateDatabases = new WeakSet<DatabaseSync>();

function repairStateSchema(
  pathname: string,
  env: NodeJS.ProcessEnv,
): {
  changes: string[];
  warnings: string[];
} {
  ensureCarapaceStatePermissions(pathname, env);
  const db = openNodeSqliteDatabase(pathname);
  const rebuiltIndexNames = new Set<string>();
  let ownershipRefused = false;
  try {
    db.exec(`PRAGMA busy_timeout = ${CARAPACE_SQLITE_BUSY_TIMEOUT_MS};`);
    assertSupportedStateSchemaVersion(db, pathname);
    db.exec("PRAGMA foreign_keys = OFF;");
    const changes = runStateSchemaMigrationTransaction(
      db,
      pathname,
      () => {
        assertCarapaceStateWriteAllowed({ database: db, databasePath: pathname, env });
        const applied: string[] = [];
        const previousVersion = readStateSchemaContentVersion(db);
        if (previousVersion === CARAPACE_STATE_SCHEMA_VERSION) {
          for (const name of repairCanonicalSqliteIndexes(db, pathname, CARAPACE_STATE_SCHEMA_SQL, {
            allowMissingColumns: true,
          })) {
            rebuiltIndexNames.add(name);
          }
          // Current-schema doctor repair may normalize recognized columns or
          // table options, but it must never recreate a missing table empty.
          assertSqliteSchemaTablesPresent(db, pathname, CARAPACE_STATE_SCHEMA_SQL, {
            allowedMissingTables: LAZY_ADDITIVE_STATE_TABLES,
          });
        } else {
          carapaceStateMigrationAssertions.get(previousVersion)?.(db, { pathname });
        }
        if (rebuiltIndexNames.size === 0) {
          assertSqliteIntegrity(db, pathname);
        }
        dropLegacyStateTables(db);
        applied.push(...retirements.runRetiredStateTableMigrations(db, previousVersion));
        if (migrateSingletonStateFoldInV12(db, previousVersion)) {
          applied.push("Folded singleton state tables into config_machine_state (v12)");
        }
        if (migrateWorkerPlacementExecutionModeSchema(db, previousVersion)) {
          applied.push("Migrated cloud worker placements to execution modes");
        }
        applied.push(
          ...describeAgentPathMigration(migrateAgentPaths(db, previousVersion, pathname)),
        );
        if (repairAgentDatabasesCompositePrimaryKey(db)) {
          applied.push(`Migrated shared state agent database registry primary key → agent_id,path`);
        }
        if (repairAuditEventsSchema(db)) {
          applied.push(
            `Migrated shared state audit event ledger → versioned message lifecycle schema`,
          );
        }
        applied.push(...operatorApprovalMigration.repairOperatorApprovalSchema(db));
        const needsSessionWatchMigration =
          sessionWatchMigration.needsSessionWatchCursorProvenanceMigration(db, previousVersion);
        const sessionWatchResult = sessionWatchMigration.migrateSessionWatchCursorProvenance(db);
        if (needsSessionWatchMigration) {
          applied.push(
            `Migrated shared state session watch cursors → provenance column (${sessionWatchResult.migratedAmbientWatches} ambient, ${sessionWatchResult.removedLegacySentinels} sentinels removed)`,
          );
        }
        assertCanonicalStateSchemaShape(db, pathname);
        if (tableExists(db, "audit_events")) {
          ensureAdditiveStateColumns(db);
          for (const migration of versionedStateMigrations) {
            if (migration.migrate(db, previousVersion)) {
              applied.push(migration.applied);
            }
          }
          executeCanonicalStateSchema(db, {
            includeVersionLazyAdditiveTables: previousVersion !== CARAPACE_STATE_SCHEMA_VERSION,
          });
          if (previousVersion < CARAPACE_STATE_STRICT_SCHEMA_VERSION) {
            repairLegacyGatewayRestartHandoffsForStrictMigration(db);
            ensureFirstUseAdditiveStateColumnsForStrictMigration(db);
          }
          const strictMigration = migrateSqliteSchemaToStrictInTransaction(
            db,
            getCarapaceStateRuntimeSchema({
              includeVersionLazyAdditiveTables: previousVersion !== CARAPACE_STATE_SCHEMA_VERSION,
            }),
            { databaseLabel: pathname },
          );
          if (strictMigration.migratedTables.length > 0) {
            applied.push(
              `Migrated shared state tables to SQLite STRICT typing (${strictMigration.migratedTables.length})`,
            );
          }
          for (const name of repairCanonicalSqliteIndexes(db, pathname, CARAPACE_STATE_SCHEMA_SQL, {
            verifyPhysicalIntegrity: false,
          })) {
            rebuiltIndexNames.add(name);
          }
        }
        markCurrentStateSchemaVersion(db, {
          createMetadataIfMissing: previousVersion < CARAPACE_STATE_SCHEMA_VERSION,
        });
        if (readStateSchemaContentVersion(db) === CARAPACE_STATE_SCHEMA_VERSION) {
          assertCurrentStateRuntimeSchema(db, pathname);
        }
        if (rebuiltIndexNames.size > 0) {
          applied.push(`Rebuilt canonical shared-state SQLite indexes (${rebuiltIndexNames.size})`);
        }
        return applied;
      },
      {
        busyTimeoutMs: CARAPACE_SQLITE_BUSY_TIMEOUT_MS,
        databaseLabel: pathname,
        operationLabel: "state.schema.repair",
      },
    );
    const quarantineCleared = clearCarapaceDatabaseQuarantine(pathname, { env });
    clearCarapaceStateDatabaseOpenFailure(pathname);
    return {
      changes,
      warnings: quarantineCleared
        ? []
        : [
            `Persisted quarantine record for ${pathname} could not be cleared; rerun carapace doctor --fix so the repaired database is not refused again.`,
          ],
    };
  } catch (err) {
    if (err instanceof UpdateSchemaRefusalError) {
      throw err;
    }
    if (err instanceof CarapaceStateOwnershipError) {
      ownershipRefused = true;
      throw err;
    }
    // Reaching this catch inside doctor means repair itself refused or failed,
    // so the runtime asserts' "run carapace doctor --fix" advice is circular here.
    const reason = String(err).replace(
      /has a legacy ([a-z ]+) schema; run carapace doctor --fix to migrate it\./u,
      "has a legacy $1 schema; automatic repair refused the unrecognized schema shape.",
    );
    return {
      changes: [],
      warnings: [`Failed migrating shared state database schema at ${pathname}: ${reason}`],
    };
  } finally {
    if (db.isOpen) {
      db.exec("PRAGMA foreign_keys = ON;");
    }
    clearNodeSqliteKyselyCacheForDatabase(db);
    db.close();
    if (!ownershipRefused) {
      ensureCarapaceStatePermissions(pathname, env);
    }
  }
}

export function repairCarapaceStateDatabaseSchema(options: CarapaceStateDatabaseOptions = {}): {
  changes: string[];
  warnings: string[];
} {
  const env = options.env ?? process.env;
  const pathname = resolveDatabasePath(options);
  if (!existsSync(pathname)) {
    return { changes: [], warnings: [] };
  }
  return runWithCarapaceStateWriteAccess(
    { databasePath: pathname, env },
    "state schema repair",
    () => withStateSchemaFence({ databasePath: pathname }, () => repairStateSchema(pathname, env)),
  );
}

/** Skip the exclusive doctor repair when automatic migration sees a canonical current schema. */
export function repairCarapaceStateDatabaseSchemaIfNeeded(
  options: CarapaceStateDatabaseOptions = {},
): {
  changes: string[];
  warnings: string[];
} {
  const env = options.env ?? process.env;
  const pathname = resolveDatabasePath(options);
  if (!existsSync(pathname)) {
    return { changes: [], warnings: [] };
  }

  return runWithCarapaceStateWriteAccess(
    { databasePath: pathname, env },
    "state schema repair preflight/repair",
    () =>
      needsCarapaceStateDatabaseSchemaRepair(pathname)
        ? withStateSchemaFence({ databasePath: pathname }, () => repairStateSchema(pathname, env))
        : { changes: [], warnings: [] },
  );
}

function ensureSchema(
  db: DatabaseSync,
  pathname: string,
  env: NodeJS.ProcessEnv,
  busyTimeoutMs = CARAPACE_SQLITE_BUSY_TIMEOUT_MS,
  initializeNativeOnly = false,
): void {
  try {
    if (isCarapaceStateSchemaFastPathEligible(db, pathname)) {
      // Recheck ownership so a claim made during validation cannot retain a writable handle.
      assertCarapaceStateWriteAllowed({ database: db, databasePath: pathname, env });
      return;
    }
  } catch {
    // Preserve the existing transactional repair and its diagnostics for drift or corruption.
  }

  withStateSchemaFence({ databasePath: pathname }, () => {
    const now = Date.now();
    db.exec("PRAGMA foreign_keys = OFF;"); // Rebuilding referenced tables requires this before BEGIN.
    try {
      runStateSchemaMigrationTransaction(
        db,
        pathname,
        () => {
          // Recheck ownership after BEGIN IMMEDIATE to exclude a concurrent external claim.
          assertCarapaceStateWriteAllowed({ database: db, databasePath: pathname, env });
          assertSupportedStateSchemaVersion(db, pathname);
          // Native bootstrap admission is advisory until this transaction owns the
          // write. Never migrate state initialized or occupied by a concurrent owner.
          if (initializeNativeOnly && !isUninitializedNativeStartupDatabase(db)) {
            return [];
          }
          const previousVersion = readStateSchemaContentVersion(db);
          if (previousVersion === CARAPACE_STATE_SCHEMA_VERSION) {
            verifyAndRepairCanonicalSqliteIndexes(db, pathname, CARAPACE_STATE_SCHEMA_SQL, {
              allowMissingColumns: true,
              validateAfterRepair: () => assertCurrentStateRuntimeSchema(db, pathname),
            });
            ensureAdditiveStateColumns(db);
            assertCurrentStateRuntimeSchema(db, pathname);
          } else {
            carapaceStateMigrationAssertions.get(previousVersion)?.(db, { pathname });
          }
          dropLegacyStateTables(db);
          const retirementMessages = retirements.runRetiredStateTableMigrations(
            db,
            previousVersion,
          );
          migrateSingletonStateFoldInV12(db, previousVersion);
          migrateWorkerPlacementExecutionModeSchema(db, previousVersion);
          const pathMigration: AgentPathSummary = migrateAgentPaths(db, previousVersion, pathname);
          ensureAdditiveStateColumns(db);
          for (const migration of versionedStateMigrations) {
            migration.migrate(db, previousVersion);
          }
          sessionWatchMigration.migrateSessionWatchCursorProvenance(db);
          assertCanonicalStateSchemaShape(db, pathname);
          executeCanonicalStateSchema(db, {
            includeVersionLazyAdditiveTables: previousVersion !== CARAPACE_STATE_SCHEMA_VERSION,
          });
          migrateLegacyCronRunLogsToTaskRuns(db);
          if (previousVersion < CARAPACE_STATE_STRICT_SCHEMA_VERSION) {
            repairLegacyGatewayRestartHandoffsForStrictMigration(db);
            ensureFirstUseAdditiveStateColumnsForStrictMigration(db);
            migrateSqliteSchemaToStrictInTransaction(
              db,
              getCarapaceStateRuntimeSchema({
                includeVersionLazyAdditiveTables: previousVersion !== CARAPACE_STATE_SCHEMA_VERSION,
              }),
              { databaseLabel: pathname },
            );
          }
          repairCanonicalSqliteIndexes(db, pathname, CARAPACE_STATE_SCHEMA_SQL, {
            verifyPhysicalIntegrity: false,
          });
          writeCurrentStateSchemaMetadata(db, now);
          assertCarapaceStateDatabaseForMaintenance(db, { pathname });
          warnAgentPathMigration(stateDbLog, pathMigration, pathname);
          return retirementMessages;
        },
        {
          busyTimeoutMs,
          databaseLabel: pathname,
          operationLabel: "state.schema.ensure",
        },
      ).forEach(retirements.logRetiredStateTableMigration);
    } finally {
      db.exec("PRAGMA foreign_keys = ON;");
    }
  });
}

/** Bootstrap fresh/native-only state canonically before startup checkpoint access. */
export function withCarapaceStateStartupMigrationCheckpointDatabase<T>(
  callback: (db: DatabaseSync) => T,
  options: CarapaceStateDatabaseOptions = {},
): T {
  return withCarapaceStateStartupCheckpointConnection(callback, options, ensureSchema);
}

/** Complete native bootstrap without migrating mature shared state. */
export function initializeNativeCarapaceStateDatabase(
  options: CarapaceStateDatabaseOptions = {},
): void {
  initializeNativeCarapaceStateConnection(options, (db, pathname, env) =>
    ensureSchema(db, pathname, env, CARAPACE_SQLITE_BUSY_TIMEOUT_MS, true),
  );
}

/** Open existing shared state without creating, migrating, chmodding, or configuring it. */
export async function openExistingCarapaceStateDatabaseReadOnly(
  options: CarapaceStateDatabaseOptions = {},
): Promise<CarapaceStateDatabase | undefined> {
  const pathname = resolveDatabasePath(options);
  if (!existsSync(pathname)) {
    return undefined;
  }
  assertCarapaceStateDatabaseFreshOpenAllowed(options);
  const prepared = await prepareSqliteReadOnlyLocation(pathname);
  let db: DatabaseSync;
  try {
    db = openNodeSqliteDatabase(prepared.location, {
      readOnly: true,
    });
  } catch (error) {
    prepared.cleanup();
    throw error;
  }
  try {
    db.exec(`PRAGMA busy_timeout = ${CARAPACE_SQLITE_BUSY_TIMEOUT_MS};`);
    assertSupportedStateSchemaVersion(db, pathname);
    assertSqliteIntegrity(db, pathname);
    if (readStateSchemaContentVersion(db) === CARAPACE_STATE_SCHEMA_VERSION) {
      assertCarapaceStateDatabaseForMaintenance(db, { pathname });
    }
  } catch (error) {
    try {
      clearNodeSqliteKyselyCacheForDatabase(db);
      db.close();
    } catch {
      // Preserve the verification failure that explains why the database was refused.
    }
    prepared.cleanup();
    throw error;
  }
  let cleanupComplete = false;
  return {
    db,
    path: pathname,
    walMaintenance: {
      checkpoint: () => false,
      // Cleanup can fail transiently after the database closes. Keep the
      // close contract retryable until one call finishes both responsibilities.
      close: () => {
        const wasOpen = db.isOpen;
        if (!wasOpen && cleanupComplete) {
          return false;
        }
        try {
          if (wasOpen) {
            clearNodeSqliteKyselyCacheForDatabase(db);
            db.close();
          }
        } finally {
          cleanupComplete = prepared.cleanup();
        }
        return cleanupComplete;
      },
    },
  };
}

/** Open or return a cached shared state database after schema and migration checks. */

function openCarapaceStateDatabaseWithBusyTimeout(
  options: CarapaceStateDatabaseOptions = {},
  busyTimeoutMs = CARAPACE_SQLITE_BUSY_TIMEOUT_MS,
  lockFailureReporting: SqliteLockFailureReporting = "report",
): CarapaceStateDatabase {
  const env = options.env ?? process.env;
  if (options.database) {
    assertCarapaceStateWriteAllowed({
      database: options.database.db,
      databasePath: options.database.path,
      env,
    });
    return options.database;
  }
  const pathname = resolveDatabasePath(options);
  // Latched paths are quarantined: the recorder closed any live handle, and
  // every open fails fast here until doctor repairs the file and clears it.
  try {
    stateDbCache.assertCarapaceStateDatabaseOpenAllowed(pathname);
  } catch (error) {
    stateDbCache.recordCarapaceStateDatabaseLifecycleOpenError(pathname, error);
    throw error;
  }
  const cached = stateDbCache.getCachedCarapaceStateDatabase(pathname);
  if (cached?.db.isOpen) {
    assertCarapaceStateWriteAllowed({
      database: cached.db,
      databasePath: pathname,
      env,
      schemaReady: true,
    });
    if (deferredStateDatabases.has(cached.db)) {
      reconcileCarapaceStateSchemaPublication(options);
      if (readSqliteUserVersion(cached.db) === CARAPACE_STATE_SCHEMA_VERSION) {
        deferredStateDatabases.delete(cached.db);
      }
    }
    return cached;
  }
  try {
    assertCarapaceStateDatabaseFreshOpenAllowed(options);
  } catch (error) {
    stateDbCache.recordCarapaceStateDatabaseLifecycleOpenError(pathname, error);
    throw error;
  }
  let unpublished: CarapaceStateDatabase | undefined;
  try {
    unpublished = runWithCarapaceStateWriteAccess(
      { databasePath: pathname, busyTimeoutMs, env },
      "fresh state database open",
      () => {
        if (cached) {
          // A closed handle can leave Kysely and WAL helpers cached; clear both under access.
          stateDbCache.closeStaleCachedCarapaceStateDatabase(cached);
        }
        return (unpublished = openUnpublishedStateDatabase({
          pathname,
          env,
          busyTimeoutMs,
          lockFailureReporting,
          ensureSchema: (database) => ensureSchema(database, pathname, env, busyTimeoutMs),
          recordOpenFailure: recordCarapaceStateDatabaseOpenFailure,
        }));
      },
    );
  } catch (error) {
    if (lockFailureReporting === "report" || !isCarapaceStateWriteContentionError(error)) {
      stateDbCache.recordCarapaceStateDatabaseLifecycleOpenError(pathname, error);
    }
    if (!unpublished) {
      throw error;
    }
    const errors = stateDbCache.closeCarapaceStateDatabaseHandle(unpublished);
    if (errors.length > 0) {
      throw createSqliteLifecycleAggregateError(
        [error, ...errors],
        `Fresh Carapace state database open failed releasing access and closing its unpublished handle for ${pathname}.`,
        error,
      );
    }
    throw error;
  }
  const database = stateDbCache.publishCarapaceStateDatabase(unpublished);
  if (readSqliteUserVersion(database.db) < CARAPACE_STATE_SCHEMA_VERSION) {
    deferredStateDatabases.add(database.db);
    reconcileCarapaceStateSchemaPublication(options);
  }
  return database;
}

/** Open or return a cached shared state database after schema and migration checks. */
export function openCarapaceStateDatabase(
  options: CarapaceStateDatabaseOptions = {},
): CarapaceStateDatabase {
  return openCarapaceStateDatabaseWithBusyTimeout(options);
}

/** The Gateway watcher also publishes without requiring a new physical database open. */
export function reconcileCarapaceStateSchemaPublication(
  options: CarapaceStateDatabaseOptions = {},
): StateSchemaPublicationBlocker | undefined {
  const pending = withExistingCarapaceStateDatabaseReadOnly(({ db }) => {
    if (
      readSqliteUserVersion(db) >= CARAPACE_STATE_SCHEMA_VERSION ||
      readStateSchemaContentVersion(db) < CARAPACE_STATE_SCHEMA_VERSION
    ) {
      return undefined;
    }
    return { blocker: readStateSchemaPublicationBlocker(db) };
  }, options);
  if (!pending || pending.blocker) {
    return pending?.blocker;
  }
  const pathname = resolveDatabasePath(options);
  try {
    return withStateSchemaFence({ databasePath: pathname }, () =>
      runCarapaceStateWriteTransaction(
        ({ db }) => {
          // The advisory read may race a new update. Re-read every driver under the write lock.
          const blocker = readStateSchemaPublicationBlocker(db);
          if (blocker) {
            return blocker;
          }
          assertCarapaceStateDatabaseForMaintenance(db, { pathname });
          markCurrentStateSchemaVersion(db);
          return undefined;
        },
        options,
        { operationLabel: "state.schema.publish" },
      ),
    );
  } catch (error) {
    // Current content is ready for readers; a live Gateway owns optional publication.
    if (error instanceof StateSchemaMutationConflictError) {
      return undefined;
    }
    throw error;
  }
}

/** Run one operation through the shared owner without waiting synchronously on SQLite locks. */
export function runWithCarapaceStateBusyTimeout<T>(
  operation: (database: CarapaceStateDatabase) => T,
  options: CarapaceStateDatabaseOptions,
  busyTimeoutMs: number,
): T {
  const normalizedTimeoutMs = normalizeSqliteNonNegativeInteger(busyTimeoutMs, "busyTimeoutMs");
  const existing = options.database ?? getCarapaceStateDatabaseIfOpen(options);
  if (existing) {
    return runWithSqliteBusyTimeout(existing.db, normalizedTimeoutMs, () => operation(existing), {
      lockFailureReporting: "suppress",
    });
  }
  const opened = openCarapaceStateDatabaseWithBusyTimeout(options, normalizedTimeoutMs, "suppress");
  try {
    return runWithSqliteBusyTimeout(opened.db, normalizedTimeoutMs, () => operation(opened), {
      lockFailureReporting: "suppress",
    });
  } finally {
    if (opened.db.isOpen) {
      setSqliteBusyTimeout(opened.db, CARAPACE_SQLITE_BUSY_TIMEOUT_MS);
    }
  }
}

/** Run a synchronous immediate transaction against the shared state database. */
export function runCarapaceStateWriteTransaction<T>(
  operation: (database: CarapaceStateDatabase) => T,
  options: CarapaceStateDatabaseOptions = {},
  transactionOptions: Pick<
    SqliteTransactionOptions,
    "busyTimeoutMs" | "operationLabel" | "slowTransactionHoldMs"
  > = {},
): T {
  let database = options.database ?? getCarapaceStateDatabaseIfOpen(options);
  let result: T;
  try {
    const acquired = options.database
      ? openCarapaceStateDatabase(options)
      : (database ?? openCarapaceStateDatabase(options));
    database = acquired;
    result = withSqlitePostCommitPublications(acquired.db, () =>
      runSqliteImmediateTransactionSync(
        acquired.db,
        () => {
          assertCarapaceStateWriteAllowed({
            database: acquired.db,
            databasePath: acquired.path,
            env: options.env ?? process.env,
            schemaReady: !options.database && acquired === getCarapaceStateDatabaseIfOpen(options),
          });
          return operation(acquired);
        },
        {
          busyTimeoutMs: transactionOptions.busyTimeoutMs ?? readSqliteBusyTimeout(acquired.db),
          databaseLabel: acquired.path,
          ...transactionOptions,
          operationLabel: transactionOptions.operationLabel ?? "state.write",
        },
      ),
    );
  } catch (error) {
    if (database) {
      stateDbCache.evictCarapaceStateDatabaseAfterCorruption(database, error);
    }
    throw error;
  }
  try {
    ensureCarapaceStatePermissions(database.path, options.env ?? process.env);
  } catch {
    // The write already committed; permission hardening is best-effort here so
    // callers never retry an operation that is durable in SQLite.
  }
  return result;
}

/**
 * Return a shared state handle this process already holds open, if any.
 *
 * Read-only callers use this to avoid opening a connection per call; it never
 * creates, repairs, or registers a handle.
 */
function getCarapaceStateDatabaseIfOpen(
  options: CarapaceStateDatabaseOptions = {},
): CarapaceStateDatabase | undefined {
  return stateDbCache.getCarapaceStateDatabaseIfOpenAtPath(resolveDatabasePath(options));
}

export {
  recordCarapaceStateDatabaseOpenFailure,
  clearCarapaceStateDatabaseOpenFailure,
  closeCarapaceStateDatabaseByPath,
  closeCarapaceStateDatabase,
  isCarapaceStateDatabaseOpen,
  closeCarapaceStateDatabaseForTest,
} from "./carapace-state-db-cache.js";

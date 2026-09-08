import { AsyncLocalStorage } from "node:async_hooks";
import { statSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { clearNodeSqliteKyselyCacheForDatabase } from "../infra/kysely-sync-cache-state.js";
import { openNodeSqliteDatabase } from "../infra/node-sqlite.js";
import { prepareSqliteReadOnlyLocationSync } from "../infra/sqlite-readonly-location.js";
import { resolveGlobalSingleton } from "../shared/global-singleton.js";
import { carapaceStateDatabaseCache } from "./carapace-state-db-cache.js";
import {
  CARAPACE_SQLITE_BUSY_TIMEOUT_MS,
  type CarapaceStateDatabaseOptions,
} from "./carapace-state-db-contract.js";
import { assertSupportedStateSchemaVersion } from "./carapace-state-db-schema-version.js";
import { resolveCarapaceStateSqlitePath } from "./carapace-state-db.paths.js";

const artifactPreservingReads = resolveGlobalSingleton(
  Symbol.for("carapace.artifactPreservingStateReads"),
  () => new AsyncLocalStorage<boolean>(),
);

/** Admission scopes every nested reader without changing normal live-read semantics. */
export function withArtifactPreservingStateReads<T>(operation: () => T): T {
  return artifactPreservingReads.run(true, operation);
}

type CarapaceStateReadOnlyDatabase = {
  db: DatabaseSync;
  path: string;
};

type ReusedCarapaceStateReadOnlyDatabase<T> = { reused: false } | { reused: true; value: T };

/** Missing runtime tables are empty only before state grows beyond checkpoint bootstrap. */
export function hasCarapaceStateTablesBeyondStartupCheckpoint(db: DatabaseSync): boolean {
  return (
    /* sqlite-allow-raw -- Read-only startup-checkpoint schema discriminator. */ db
      .prepare(
        "SELECT 1 FROM main.sqlite_schema WHERE type = 'table' AND name NOT IN ('schema_meta', 'state_leases') LIMIT 1",
      )
      .get() !== undefined
  );
}

function resolveReadOnlyPath(options: CarapaceStateDatabaseOptions): string {
  return path.resolve(options.path ?? resolveCarapaceStateSqlitePath(options.env ?? process.env));
}

function existingPathOrUndefined(pathname: string): string | undefined {
  try {
    statSync(pathname);
    return pathname;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function withCarapaceStateDatabaseReadOnlyIfOpen<T>(
  operation: (database: CarapaceStateReadOnlyDatabase) => T,
  pathname: string,
): ReusedCarapaceStateReadOnlyDatabase<T> {
  const opened = carapaceStateDatabaseCache.getCarapaceStateDatabaseIfOpenAtPath(pathname);
  if (!opened || opened.db.isTransaction) {
    return { reused: false };
  }
  try {
    // Cached reads skip persisted quarantine checks; terminal failures evict handles.
    // Another process can migrate the file, so version admission still runs.
    assertSupportedStateSchemaVersion(opened.db, pathname);
    return { reused: true, value: operation(opened) };
  } catch (error) {
    carapaceStateDatabaseCache.evictCarapaceStateDatabaseAfterCorruption(opened, error);
    throw error;
  }
}

function withFreshCarapaceStateDatabaseReadOnly<T>(
  operation: (database: CarapaceStateReadOnlyDatabase) => T,
  options: CarapaceStateDatabaseOptions,
  pathname: string,
): T {
  const env = options.env ?? process.env;
  carapaceStateDatabaseCache.assertCarapaceStateDatabaseFreshOpenAllowedAtPath(pathname, env);
  // Even read-only SQLite opens can create a missing WAL. The existing worker
  // snapshots committed WAL pages without touching source sidecars or caller-held locks.
  const prepared = artifactPreservingReads.getStore()
    ? prepareSqliteReadOnlyLocationSync(pathname)
    : undefined;
  try {
    const db = openNodeSqliteDatabase(prepared?.location ?? pathname, { readOnly: true });
    try {
      db.exec(`PRAGMA busy_timeout = ${CARAPACE_SQLITE_BUSY_TIMEOUT_MS};`);
      assertSupportedStateSchemaVersion(db, pathname);
      return operation({ db, path: pathname });
    } finally {
      clearNodeSqliteKyselyCacheForDatabase(db);
      db.close();
    }
  } finally {
    prepared?.cleanup();
  }
}

/** Read shared state without joining writers; admission inherits artifact preservation. */
export function withCarapaceStateDatabaseReadOnly<T>(
  operation: (database: CarapaceStateReadOnlyDatabase) => T,
  options: CarapaceStateDatabaseOptions = {},
): T {
  const pathname = resolveReadOnlyPath(options);
  // Reuse idle handles for row loops; never expose an in-flight transaction's
  // uncommitted rows to a reader that would otherwise open a fresh connection.
  const reused = withCarapaceStateDatabaseReadOnlyIfOpen(operation, pathname);
  if (reused.reused) {
    return reused.value;
  }
  return withFreshCarapaceStateDatabaseReadOnly(operation, options, pathname);
}

/** Read existing shared state while preserving non-missing filesystem failures. */
export function withExistingCarapaceStateDatabaseReadOnly<T>(
  operation: (database: CarapaceStateReadOnlyDatabase) => T,
  options: CarapaceStateDatabaseOptions = {},
): T | undefined {
  const pathname = resolveReadOnlyPath(options);
  const reused = withCarapaceStateDatabaseReadOnlyIfOpen(operation, pathname);
  if (reused.reused) {
    return reused.value;
  }
  const existingPath = existingPathOrUndefined(pathname);
  return existingPath === undefined
    ? undefined
    : withFreshCarapaceStateDatabaseReadOnly(operation, options, existingPath);
}

export function withExistingCarapaceStateDatabaseArtifactPreservingReadOnly<T>(
  operation: (database: CarapaceStateReadOnlyDatabase) => T,
  options: CarapaceStateDatabaseOptions = {},
): T | undefined {
  return withArtifactPreservingStateReads(() =>
    withExistingCarapaceStateDatabaseReadOnly(operation, options),
  );
}

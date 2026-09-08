import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  clearNodeSqliteKyselyCacheForDatabase,
  registerNodeSqliteKyselyQueryErrorHandler,
} from "../infra/kysely-sync-cache-state.js";
import type { SqliteFileGeneration } from "../infra/sqlite-file-generation.js";
import { createSqliteTerminalOpenLatch } from "../infra/sqlite-terminal-open-latch.js";
import { isSqliteCorruptionError } from "../infra/sqlite-transaction.js";
import { isSqliteSchemaVersionError } from "../infra/sqlite-user-version.js";
import {
  createCarapaceDatabaseVerificationError,
  readCarapaceDatabaseQuarantine,
} from "./carapace-quarantine-store.js";
import type { CarapaceStateDatabase } from "./carapace-state-db-contract.js";
import { assertSupportedStateSchemaVersion } from "./carapace-state-db-schema-version.js";

const cachedDatabases = new Map<string, CarapaceStateDatabase>();
// Statements retain their native database; key by the plain lifecycle owner so
// removing that owner releases the statement instead of rooting its own weak key.
const cachedDataVersionStatements = new WeakMap<
  CarapaceStateDatabase,
  ReturnType<DatabaseSync["prepare"]>
>();
const cachedDataVersions = new WeakMap<DatabaseSync, number>();
type CarapaceStateDatabaseLifecycleEvent =
  | { kind: "opened"; database: CarapaceStateDatabase }
  | { kind: "closed"; path: string }
  | { kind: "open-error"; path: string; error: unknown };
const databaseLifecycleListeners = new Set<(event: CarapaceStateDatabaseLifecycleEvent) => void>();

function notifyCarapaceStateDatabaseLifecycle(event: CarapaceStateDatabaseLifecycleEvent): void {
  for (const listener of databaseLifecycleListeners) {
    listener(event);
  }
}

function readSqliteDataVersion(database: CarapaceStateDatabase): number {
  let statement = cachedDataVersionStatements.get(database);
  if (!statement) {
    statement = database.db /* sqlite-allow-raw -- Connection-local schema compatibility counter. */
      .prepare("PRAGMA data_version");
    cachedDataVersionStatements.set(database, statement);
  }
  // SAFETY: SQLite defines this pragma's single-column row; the value is validated below.
  const row = statement.get() as { data_version?: unknown } | undefined;
  if (typeof row?.data_version !== "number") {
    throw new Error("SQLite did not return a numeric PRAGMA data_version");
  }
  return row.data_version;
}

export function registerCarapaceStateDatabaseLifecycleListener(
  listener: (event: CarapaceStateDatabaseLifecycleEvent) => void,
): () => void {
  databaseLifecycleListeners.add(listener);
  for (const database of cachedDatabases.values()) {
    if (database.db.isOpen) {
      listener({ kind: "opened", database });
    }
  }
  return () => databaseLifecycleListeners.delete(listener);
}

/** Close both physical-handle owners while retaining every cleanup failure. */
function closeCarapaceStateDatabaseHandle(
  database: CarapaceStateDatabase,
  options?: Parameters<CarapaceStateDatabase["walMaintenance"]["close"]>[0],
): unknown[] {
  const errors: unknown[] = [];
  try {
    database.walMaintenance.close(options);
  } catch (error) {
    errors.push(error);
  }
  clearNodeSqliteKyselyCacheForDatabase(database.db);
  try {
    if (database.db.isOpen) {
      database.db.close();
    }
  } catch (error) {
    errors.push(error);
  }
  return errors;
}

function evictCachedCarapaceStateDatabase(database: CarapaceStateDatabase): boolean {
  if (cachedDatabases.get(database.path) !== database) {
    return false;
  }
  // Remove ownership before cleanup. A poisoned native handle can reject close,
  // but it must never remain discoverable as the process-wide shared handle.
  cachedDatabases.delete(database.path);
  notifyCarapaceStateDatabaseLifecycle({ kind: "closed", path: database.path });
  // A poisoned cache owner is not the database lifecycle owner. PASSIVE avoids
  // waiting on readers or resetting recovery frames another connection needs.
  closeCarapaceStateDatabaseHandle(database, { checkpointMode: "PASSIVE" });
  return true;
}

/** Evict an exact cached shared-state owner after a proven corruption read. */
function evictCarapaceStateDatabaseAfterCorruption(
  database: CarapaceStateDatabase,
  error: unknown,
): boolean {
  return isSqliteCorruptionError(error) && evictCachedCarapaceStateDatabase(database);
}

const terminalOpenLatch = createSqliteTerminalOpenLatch({
  closeByPath: (pathname) => {
    const cached = cachedDatabases.get(pathname);
    if (cached) {
      evictCachedCarapaceStateDatabase(cached);
    }
  },
});

/** Publish a fully opened handle and bind query corruption to its exact cache owner. */
function publishCarapaceStateDatabase(database: CarapaceStateDatabase): CarapaceStateDatabase {
  const { db, path: pathname } = database;
  cachedDataVersions.set(db, readSqliteDataVersion(database));
  cachedDatabases.set(pathname, database);
  notifyCarapaceStateDatabaseLifecycle({ kind: "opened", database });
  registerNodeSqliteKyselyQueryErrorHandler(db, (error) => {
    // Write transactions own rollback and evict at their outer boundary.
    if (!db.isTransaction && isSqliteCorruptionError(error)) {
      evictCachedCarapaceStateDatabase(database);
    }
  });
  terminalOpenLatch.clear(pathname);
  return database;
}

/** Revalidate a cached owner after another connection commits to its database. */
function getCarapaceStateDatabaseRuntimeFailure(pathname: string): Error | undefined {
  const resolvedPath = path.resolve(pathname);
  const latched = terminalOpenLatch.get(resolvedPath);
  if (latched) {
    return latched;
  }
  const cached = cachedDatabases.get(resolvedPath);
  if (!cached?.db.isOpen) {
    return undefined;
  }
  try {
    const dataVersion = readSqliteDataVersion(cached);
    if (cachedDataVersions.get(cached.db) === dataVersion) {
      return undefined;
    }
    // data_version is the cheap external-commit trigger. Recheck published and
    // content versions only when another connection changed the file.
    assertSupportedStateSchemaVersion(cached.db, resolvedPath);
    cachedDataVersions.set(cached.db, dataVersion);
    return undefined;
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    if (isSqliteCorruptionError(failure)) {
      evictCachedCarapaceStateDatabase(cached);
      return undefined;
    }
    if (isSqliteSchemaVersionError(failure)) {
      terminalOpenLatch.record(resolvedPath, failure);
      notifyCarapaceStateDatabaseLifecycle({
        kind: "open-error",
        path: resolvedPath,
        error: failure,
      });
    }
    return failure;
  }
}

function getCachedCarapaceStateDatabase(pathname: string): CarapaceStateDatabase | undefined {
  const runtimeFailure = getCarapaceStateDatabaseRuntimeFailure(pathname);
  if (runtimeFailure) {
    throw runtimeFailure;
  }
  return cachedDatabases.get(path.resolve(pathname));
}

function getCarapaceStateDatabaseIfOpenAtPath(pathname: string): CarapaceStateDatabase | undefined {
  const cached = getCachedCarapaceStateDatabase(pathname);
  return cached?.db.isOpen ? cached : undefined;
}

/** Remove a closed cached owner while fresh-open access is held. */
function closeStaleCachedCarapaceStateDatabase(database: CarapaceStateDatabase): void {
  if (cachedDatabases.get(database.path) !== database) {
    return;
  }
  database.walMaintenance.close();
  clearNodeSqliteKyselyCacheForDatabase(database.db);
  cachedDatabases.delete(database.path);
  notifyCarapaceStateDatabaseLifecycle({ kind: "closed", path: database.path });
}

/** Latch background verification damage so later opens fail without rescanning. */
export function recordCarapaceStateDatabaseOpenFailure(
  pathname: string,
  error: Error,
  generation?: SqliteFileGeneration,
): boolean {
  return terminalOpenLatch.record(pathname, error, generation);
}

/** Clear a terminal open failure after doctor rewrites the database file. */
export function clearCarapaceStateDatabaseOpenFailure(pathname: string): void {
  terminalOpenLatch.clear(pathname);
}

/** Reject shared-state access after a process-local terminal failure. */
function assertCarapaceStateDatabaseOpenAllowed(pathname: string): void {
  const terminalFailure = terminalOpenLatch.get(pathname);
  if (terminalFailure) {
    throw terminalFailure;
  }
}

function recordCarapaceStateDatabaseLifecycleOpenError(pathname: string, error: unknown): void {
  notifyCarapaceStateDatabaseLifecycle({ kind: "open-error", path: path.resolve(pathname), error });
}

/** Reject a fresh shared-state open after known corruption until repair clears it. */
function assertCarapaceStateDatabaseFreshOpenAllowedAtPath(
  pathname: string,
  env: NodeJS.ProcessEnv,
): void {
  assertCarapaceStateDatabaseOpenAllowed(pathname);
  let quarantineFailure: Error | undefined;
  try {
    const quarantine = readCarapaceDatabaseQuarantine(pathname, { env });
    if (quarantine) {
      quarantineFailure = createCarapaceDatabaseVerificationError(
        "state",
        pathname,
        quarantine.reason,
      );
    }
  } catch {
    // A broken quarantine store must not brick every state read.
    // The process latch and daily verifier still cover known damage.
  }
  if (quarantineFailure) {
    throw quarantineFailure;
  }
}

/** Close one cached shared state database handle by exact pathname. */
export function closeCarapaceStateDatabaseByPath(pathname: string): boolean {
  const resolvedPath = path.resolve(pathname);
  const database = cachedDatabases.get(resolvedPath);
  if (!database) {
    return false;
  }
  database.walMaintenance.close();
  if (database.db.isOpen) {
    database.db.close();
  }
  cachedDatabases.delete(resolvedPath);
  notifyCarapaceStateDatabaseLifecycle({ kind: "closed", path: resolvedPath });
  return true;
}

/** Close all cached shared state database handles. */
export function closeCarapaceStateDatabase(
  options?: Parameters<CarapaceStateDatabase["walMaintenance"]["close"]>[0],
): void {
  for (const database of cachedDatabases.values()) {
    database.walMaintenance.close(options);
    if (database.db.isOpen) {
      database.db.close();
    }
    notifyCarapaceStateDatabaseLifecycle({ kind: "closed", path: database.path });
  }
  cachedDatabases.clear();
}

/** Test whether a cached shared state database handle is still open, optionally at one path. */
export function isCarapaceStateDatabaseOpen(pathname?: string): boolean {
  if (pathname !== undefined) {
    return cachedDatabases.get(path.resolve(pathname))?.db.isOpen === true;
  }
  return Array.from(cachedDatabases.values()).some((database) => database.db.isOpen);
}

/** Close shared state handles and clear terminal failure latches for test isolation. */
export function closeCarapaceStateDatabaseForTest(): void {
  closeCarapaceStateDatabase();
  terminalOpenLatch.clearAll();
}

/** Process-wide owner for cached shared-state handles and terminal open failures. */
export const carapaceStateDatabaseCache = {
  assertCarapaceStateDatabaseFreshOpenAllowedAtPath,
  assertCarapaceStateDatabaseOpenAllowed,
  clearCarapaceStateDatabaseOpenFailure,
  closeCarapaceStateDatabase,
  closeCarapaceStateDatabaseByPath,
  closeCarapaceStateDatabaseForTest,
  closeCarapaceStateDatabaseHandle,
  closeStaleCachedCarapaceStateDatabase,
  evictCachedCarapaceStateDatabase,
  evictCarapaceStateDatabaseAfterCorruption,
  getCachedCarapaceStateDatabase,
  getCarapaceStateDatabaseRuntimeFailure,
  getCarapaceStateDatabaseIfOpenAtPath,
  isCarapaceStateDatabaseOpen,
  publishCarapaceStateDatabase,
  recordCarapaceStateDatabaseOpenFailure,
  recordCarapaceStateDatabaseLifecycleOpenError,
};

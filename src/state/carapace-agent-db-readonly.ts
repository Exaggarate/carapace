import fs from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { clearNodeSqliteKyselyCacheForDatabase } from "../infra/kysely-sync.js";
import { openNodeSqliteDatabase } from "../infra/node-sqlite.js";
import { normalizeAgentId } from "../routing/session-key.js";
import type {
  CarapaceAgentDatabase,
  CarapaceAgentDatabaseOptions,
} from "./carapace-agent-db-contract.js";
import {
  createCarapaceAgentDatabaseClaim,
  registerCarapaceAgentDatabaseIdentity,
  type CarapaceAgentDatabaseClaim,
} from "./carapace-agent-db-identity.js";
import {
  assertCanonicalAgentPersistenceVersion,
  assertExistingAgentSchemaOwner,
  assertSupportedAgentSchemaVersion,
  readExistingAgentSchemaMeta,
} from "./carapace-agent-db-schema-helpers.js";
import {
  borrowCarapaceAgentDatabase,
  getCarapaceAgentDatabaseIfOpen,
} from "./carapace-agent-db.js";
import {
  isIncognitoCarapaceAgentSqlitePath,
  resolveCarapaceAgentSqlitePath,
} from "./carapace-agent-db.paths.js";
import { CARAPACE_SQLITE_BUSY_TIMEOUT_MS } from "./carapace-state-db-contract.js";

export type CarapaceAgentReadOnlyDatabase = {
  agentId: string;
  db: DatabaseSync;
  path: string;
};

type CarapaceAgentDatabaseReadOnlyResult<T> =
  | { found: true; value: T }
  | { found: false; reason: "database-missing" | "schema-missing" | "table-missing" };

export type CarapaceAgentReadOnlyDatabaseHandle = CarapaceAgentReadOnlyDatabase & {
  close: () => void;
};

export type CarapaceAgentDatabaseReadOnlyOpenResult =
  | { found: true; database: CarapaceAgentReadOnlyDatabaseHandle }
  | { found: false; reason: "database-missing" | "schema-missing" };

type CarapaceAgentDatabaseReadOnlyBehavior = {
  throwOnMissingTable?: boolean;
  allowExtension?: boolean;
};

/**
 * Look up a process-held handle without adopting writer-side failures.
 *
 * Read-only reads are meant to survive a latched open failure or an ownership
 * mismatch that only the writable lifecycle cares about; those callers fall
 * back to a fresh connection, which reports the precise reason.
 */
function findOpenAgentDatabase(
  options: CarapaceAgentDatabaseOptions,
): CarapaceAgentDatabase | undefined {
  try {
    return getCarapaceAgentDatabaseIfOpen(options);
  } catch {
    return undefined;
  }
}

/** Open one existing agent database without creating, registering, migrating, or adopting it. */
export function openCarapaceAgentDatabaseReadOnly(
  options: CarapaceAgentDatabaseOptions,
  behavior: Pick<CarapaceAgentDatabaseReadOnlyBehavior, "allowExtension"> = {},
): CarapaceAgentDatabaseReadOnlyOpenResult {
  const agentId = normalizeAgentId(options.agentId);
  const pathname = resolveCarapaceAgentSqlitePath({ ...options, agentId });
  if (isIncognitoCarapaceAgentSqlitePath(pathname, { agentId, env: options.env })) {
    return { found: false, reason: "database-missing" };
  }
  if (!fs.existsSync(pathname)) {
    return { found: false, reason: "database-missing" };
  }
  const db = openNodeSqliteDatabase(pathname, {
    readOnly: true,
    ...(behavior.allowExtension ? { allowExtension: true } : {}),
  });
  let closed = false;
  const close = () => {
    if (closed) {
      return;
    }
    closed = true;
    clearNodeSqliteKyselyCacheForDatabase(db);
    db.close();
  };
  try {
    registerCarapaceAgentDatabaseIdentity(db);
    db.exec(`PRAGMA busy_timeout = ${CARAPACE_SQLITE_BUSY_TIMEOUT_MS};`);
    const userVersion = assertSupportedAgentSchemaVersion(db, pathname);
    assertCanonicalAgentPersistenceVersion(db, pathname, userVersion);
    const schemaMeta = readExistingAgentSchemaMeta(db);
    if (!schemaMeta) {
      close();
      return { found: false, reason: "schema-missing" };
    }
    assertExistingAgentSchemaOwner(schemaMeta, agentId, pathname);
    return { found: true, database: { agentId, db, path: pathname, close } };
  } catch (error) {
    close();
    throw error;
  }
}

/** Retain an existing store across awaits without materializing a writable database. */
export function retainCarapaceAgentDatabaseReadOnly(
  options: CarapaceAgentDatabaseOptions,
):
  | { found: true; claim: CarapaceAgentDatabaseClaim }
  | { found: false; reason: "database-missing" | "schema-missing" } {
  const opened = findOpenAgentDatabase(options);
  if (opened && !opened.db.isTransaction) {
    const borrowed = borrowCarapaceAgentDatabase(options);
    return { found: true, claim: createCarapaceAgentDatabaseClaim(opened, borrowed.release) };
  }
  const fresh = openCarapaceAgentDatabaseReadOnly(options);
  return fresh.found
    ? {
        found: true,
        claim: createCarapaceAgentDatabaseClaim(fresh.database, fresh.database.close),
      }
    : fresh;
}

/** Read agent state without creating, registering, migrating, or joining its writable lifecycle. */
export function withCarapaceAgentDatabaseReadOnly<T>(
  operation: (database: CarapaceAgentReadOnlyDatabase) => T,
  options: CarapaceAgentDatabaseOptions,
  behavior: CarapaceAgentDatabaseReadOnlyBehavior = {},
): CarapaceAgentDatabaseReadOnlyResult<T> {
  const agentId = normalizeAgentId(options.agentId);
  const pathname = resolveCarapaceAgentSqlitePath({ ...options, agentId });
  if (isIncognitoCarapaceAgentSqlitePath(pathname, { agentId, env: options.env })) {
    // Read-only misses must not create process-lifetime handles; only creation and
    // write paths may materialize the process-held incognito database.
    const database = getCarapaceAgentDatabaseIfOpen({ ...options, agentId });
    if (database && behavior.allowExtension) {
      throw new Error("Extension-capable read-only access is unavailable for incognito databases.");
    }
    return database
      ? { found: true, value: operation(database) }
      : { found: false, reason: "database-missing" };
  }
  // Borrow only outside a transaction so readers see committed rows.
  // The writer owns reused handles; this call closes only fresh connections.
  const processOpened = behavior.allowExtension
    ? undefined
    : findOpenAgentDatabase({ ...options, agentId });
  const reusable = processOpened && !processOpened.db.isTransaction ? processOpened : undefined;
  const fresh = reusable
    ? undefined
    : openCarapaceAgentDatabaseReadOnly({ ...options, agentId }, behavior);
  if (fresh && !fresh.found) {
    return fresh;
  }
  const database = reusable ?? fresh!.database;
  const { db } = database;
  try {
    if (reusable) {
      // Share only this admission's fresh value; a later read must check again.
      const userVersion = assertSupportedAgentSchemaVersion(db, pathname);
      assertCanonicalAgentPersistenceVersion(db, pathname, userVersion);
    }
    try {
      return { found: true, value: operation(database) };
    } catch (error) {
      if (
        error instanceof Error &&
        (error as NodeJS.ErrnoException).code === "ERR_SQLITE_ERROR" &&
        /\bno such table:/iu.test(error.message) &&
        !behavior.throwOnMissingTable
      ) {
        return { found: false, reason: "table-missing" };
      }
      throw error;
    }
  } finally {
    if (fresh?.found) {
      fresh.database.close();
    }
  }
}

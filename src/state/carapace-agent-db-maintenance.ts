import type { DatabaseSync } from "node:sqlite";
import { clearNodeSqliteKyselyCacheForDatabase } from "../infra/kysely-sync.js";
import { openNodeSqliteDatabase } from "../infra/node-sqlite.js";
import { assertSqliteIntegrityInWorker } from "../infra/sqlite-integrity-worker.js";
import {
  createNewerSqliteSchemaVersionError,
  readSqliteUserVersion,
} from "../infra/sqlite-user-version.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { CARAPACE_AGENT_SCHEMA_VERSION } from "./carapace-agent-db-contract.js";
import { assertAgentDatabaseMaintenanceAuthority } from "./carapace-agent-db-lease.js";
import {
  assertExistingAgentSchemaOwner,
  assertCarapaceAgentSchemaContains,
  assertSupportedAgentSchemaVersion,
  readExistingAgentSchemaMeta,
} from "./carapace-agent-db-schema-helpers.js";
import { ensureCarapaceAgentDatabaseSchemaSteps } from "./carapace-agent-db-schema.js";
import { CARAPACE_AGENT_SCHEMA_SQL } from "./carapace-agent-schema.js";
import { CARAPACE_SQLITE_BUSY_TIMEOUT_MS } from "./carapace-state-db.js";
import type { CarapaceStateLeaseContext } from "./carapace-state-lease.js";

/** Require exact agent ownership without requiring the latest schema. */
export function assertCarapaceAgentDatabaseOwner(
  database: DatabaseSync,
  options: { agentId: string; pathname: string },
): NonNullable<ReturnType<typeof readExistingAgentSchemaMeta>> {
  const agentId = normalizeAgentId(options.agentId);
  const metadata = readExistingAgentSchemaMeta(database);
  if (!metadata) {
    throw new Error(
      `Carapace agent database ${options.pathname} has no schema ownership metadata.`,
    );
  }
  assertExistingAgentSchemaOwner(metadata, agentId, options.pathname);
  if (metadata.agentId !== agentId) {
    throw new Error(
      `Carapace agent database ${options.pathname} belongs to agent ${metadata.agentId}; requested agent ${agentId}.`,
    );
  }
  return metadata;
}

/** Require the exact agent owner and schema before offline file maintenance. */
export function assertCarapaceAgentDatabaseForMaintenance(
  database: DatabaseSync,
  options: { agentId: string; pathname: string },
): void {
  const metadata = assertCarapaceAgentDatabaseOwner(database, options);

  const userVersion = readSqliteUserVersion(database);
  if (userVersion > CARAPACE_AGENT_SCHEMA_VERSION) {
    throw createNewerSqliteSchemaVersionError(
      "Carapace agent database",
      options.pathname,
      userVersion,
      CARAPACE_AGENT_SCHEMA_VERSION,
    );
  }
  if (userVersion !== CARAPACE_AGENT_SCHEMA_VERSION) {
    throw new Error(
      `Carapace agent database ${options.pathname} uses schema version ${userVersion}; run carapace doctor --fix before compacting it.`,
    );
  }
  if (metadata.schemaVersion !== CARAPACE_AGENT_SCHEMA_VERSION) {
    throw new Error(
      `Carapace agent database ${options.pathname} metadata schema version ${metadata.schemaVersion ?? "invalid"} does not match ${CARAPACE_AGENT_SCHEMA_VERSION}; run carapace doctor --fix before compacting it.`,
    );
  }
  assertCarapaceAgentSchemaContains(database, options.pathname, CARAPACE_AGENT_SCHEMA_SQL);
}

/** Upgrade or repair a supported owned schema before strict offline maintenance. */
export async function migrateCarapaceAgentDatabaseForMaintenance(
  options: { agentId: string; pathname: string },
  maintenance: CarapaceStateLeaseContext,
): Promise<void> {
  const agentId = normalizeAgentId(options.agentId);
  const pathname = options.pathname;
  const env = { ...process.env };
  const assertOwned = () => {
    maintenance.signal.throwIfAborted();
    assertAgentDatabaseMaintenanceAuthority(maintenance);
  };
  assertOwned();
  const database = openNodeSqliteDatabase(pathname);
  try {
    database.exec(`PRAGMA busy_timeout = ${CARAPACE_SQLITE_BUSY_TIMEOUT_MS};`);
    const metadata = readExistingAgentSchemaMeta(database);
    if (!metadata) {
      return;
    }
    assertExistingAgentSchemaOwner(metadata, agentId, pathname);
    assertSupportedAgentSchemaVersion(database, pathname);
    const userVersion = readSqliteUserVersion(database);
    const metadataVersion = metadata.schemaVersion;
    const hasCurrentVersion =
      userVersion === CARAPACE_AGENT_SCHEMA_VERSION &&
      metadataVersion === CARAPACE_AGENT_SCHEMA_VERSION;
    const hasSupportedOlderVersion =
      userVersion >= 1 &&
      userVersion < CARAPACE_AGENT_SCHEMA_VERSION &&
      metadataVersion !== null &&
      metadataVersion === userVersion &&
      metadataVersion >= 1 &&
      metadataVersion < CARAPACE_AGENT_SCHEMA_VERSION;
    if (!hasCurrentVersion && !hasSupportedOlderVersion) {
      return;
    }
    const operation = ensureCarapaceAgentDatabaseSchemaSteps(database, {
      agentId,
      path: pathname,
      env,
    });
    try {
      let step = operation.next();
      while (!step.done) {
        assertOwned();
        try {
          // The maintenance fence and connection survive until native Worker exit.
          // Revalidate before either resume path can repair indexes or mutate schema.
          await assertSqliteIntegrityInWorker(
            step.value.databaseLabel,
            CARAPACE_SQLITE_BUSY_TIMEOUT_MS,
            maintenance.signal,
          );
        } catch (error) {
          assertOwned();
          assertExistingAgentSchemaOwner(readExistingAgentSchemaMeta(database), agentId, pathname);
          assertSupportedAgentSchemaVersion(database, pathname);
          step = operation.throw(error);
          continue;
        }
        assertOwned();
        assertExistingAgentSchemaOwner(readExistingAgentSchemaMeta(database), agentId, pathname);
        assertSupportedAgentSchemaVersion(database, pathname);
        step = operation.next();
      }
    } finally {
      operation.return();
    }
    assertOwned();
    assertCarapaceAgentDatabaseForMaintenance(database, {
      agentId,
      pathname,
    });
  } finally {
    clearNodeSqliteKyselyCacheForDatabase(database);
    database.close();
  }
}

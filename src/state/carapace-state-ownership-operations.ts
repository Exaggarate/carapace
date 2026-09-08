import type { DatabaseSync } from "node:sqlite";
import { isGatewayExternallySupervised } from "../infra/gateway-supervision.js";
import {
  clearNodeSqliteKyselyCacheForDatabase,
  executeSqliteQuerySync,
  getNodeSqliteKysely,
} from "../infra/kysely-sync.js";
import { openNodeSqliteDatabase } from "../infra/node-sqlite.js";
import { assertSqliteIntegrity } from "../infra/sqlite-integrity.js";
import { runSqliteImmediateTransactionSync } from "../infra/sqlite-transaction.js";
import { configureSqliteWalMaintenance, type SqliteWalMaintenance } from "../infra/sqlite-wal.js";
import { CARAPACE_SQLITE_BUSY_TIMEOUT_MS } from "./carapace-state-db-contract.js";
import {
  assertCarapaceStateDatabaseForMaintenance,
  resolveDatabasePath,
} from "./carapace-state-db-maintenance.js";
import type { DB as CarapaceStateKyselyDatabase } from "./carapace-state-db.generated.js";
import {
  openCarapaceStateDatabase,
  runCarapaceStateWriteTransaction,
  type CarapaceStateDatabaseOptions,
} from "./carapace-state-db.js";
import {
  inspectCarapaceStateOwnershipFromDatabase,
  normalizeCarapaceStateManagerId,
  CarapaceStateOwnershipMetadataError,
  STATE_SUPERVISION_KEY,
  type CarapaceExternalStateOwnership,
  runWithCarapaceStateOwnershipCoordinator,
} from "./carapace-state-ownership.js";

type CarapaceStateOwnershipOptions = Omit<CarapaceStateDatabaseOptions, "database" | "readOnly">;
type OwnershipDatabase = Pick<CarapaceStateKyselyDatabase, "config_machine_state">;

function requireOwnershipCheckpoint(
  walMaintenance: SqliteWalMaintenance,
  databasePath: string,
): void {
  if (!walMaintenance.checkpoint()) {
    throw new Error(
      `External ownership was committed for ${databasePath}, but its WAL checkpoint failed. Retry the same ownership claim before activating the supervisor.`,
    );
  }
}

function claimOwnershipRow(
  database: DatabaseSync,
  databasePath: string,
  managerId: string,
  repairMalformed: boolean,
): CarapaceExternalStateOwnership {
  let current: CarapaceExternalStateOwnership | null = null;
  try {
    current = inspectCarapaceStateOwnershipFromDatabase(database, databasePath);
  } catch (error) {
    if (!repairMalformed || !(error instanceof CarapaceStateOwnershipMetadataError)) {
      throw error;
    }
  }
  if (current) {
    if (current.managerId !== managerId) {
      throw new Error(
        `Carapace shared state is already claimed by external manager ${current.managerId}; ` +
          `manager ${managerId} cannot replace that durable ownership.`,
      );
    }
    return current;
  }
  const ownership: CarapaceExternalStateOwnership = {
    version: 1,
    mode: "external",
    managerId,
    claimedAt: Date.now(),
  };
  const valueJson = JSON.stringify(ownership);
  const stateDb = getNodeSqliteKysely<OwnershipDatabase>(database);
  executeSqliteQuerySync(
    database,
    stateDb
      .insertInto("config_machine_state")
      .values({
        state_key: STATE_SUPERVISION_KEY,
        value_json: valueJson,
        updated_at_ms: ownership.claimedAt,
      })
      .onConflict((conflict) =>
        conflict.column("state_key").doUpdateSet({
          value_json: valueJson,
          updated_at_ms: ownership.claimedAt,
        }),
      ),
  );
  return ownership;
}

function repairMalformedOwnershipClaim(
  databasePath: string,
  managerId: string,
): CarapaceExternalStateOwnership {
  return runWithCarapaceStateOwnershipCoordinator(
    databasePath,
    "malformed state ownership repair/checkpoint",
    () => {
      const database = openNodeSqliteDatabase(databasePath);
      let walMaintenance: SqliteWalMaintenance | undefined;
      try {
        database.exec(`PRAGMA busy_timeout = ${CARAPACE_SQLITE_BUSY_TIMEOUT_MS};`);
        assertSqliteIntegrity(database, databasePath);
        assertCarapaceStateDatabaseForMaintenance(database, { pathname: databasePath });
        walMaintenance = configureSqliteWalMaintenance(database, {
          busyTimeoutMs: CARAPACE_SQLITE_BUSY_TIMEOUT_MS,
          checkpointIntervalMs: 0,
          checkpointMode: "TRUNCATE",
          databaseLabel: "Carapace shared state ownership",
          databasePath,
        });
        const ownership = runSqliteImmediateTransactionSync(
          database,
          () => {
            assertCarapaceStateDatabaseForMaintenance(database, { pathname: databasePath });
            return claimOwnershipRow(database, databasePath, managerId, true);
          },
          {
            busyTimeoutMs: CARAPACE_SQLITE_BUSY_TIMEOUT_MS,
            databaseLabel: databasePath,
            operationLabel: "state.ownership.repair",
          },
        );
        requireOwnershipCheckpoint(walMaintenance, databasePath);
        return ownership;
      } finally {
        walMaintenance?.close({ checkpointMode: "PASSIVE" });
        clearNodeSqliteKyselyCacheForDatabase(database);
        database.close();
      }
    },
  );
}

/** Claim durable shared-state write ownership for the active external supervisor. */
export function claimCarapaceStateOwnership(
  managerId: string,
  options: CarapaceStateOwnershipOptions = {},
): CarapaceExternalStateOwnership {
  const env = options.env ?? process.env;
  if (!isGatewayExternallySupervised(env)) {
    throw new Error(
      "Claiming external shared-state ownership requires CARAPACE_SUPERVISOR_MODE=external.",
    );
  }
  const normalizedManagerId = normalizeCarapaceStateManagerId(managerId);
  try {
    const database = openCarapaceStateDatabase(options);
    return runWithCarapaceStateOwnershipCoordinator(
      database.path,
      "state ownership claim/checkpoint",
      () => {
        const ownership = runCarapaceStateWriteTransaction(
          ({ db, path: databasePath }) =>
            claimOwnershipRow(db, databasePath, normalizedManagerId, false),
          { ...options, database },
          { operationLabel: "state.ownership.claim" },
        );
        requireOwnershipCheckpoint(database.walMaintenance, database.path);
        return ownership;
      },
    );
  } catch (error) {
    if (!(error instanceof CarapaceStateOwnershipMetadataError)) {
      throw error;
    }
    const ownership = repairMalformedOwnershipClaim(
      resolveDatabasePath(options),
      normalizedManagerId,
    );
    openCarapaceStateDatabase(options);
    return ownership;
  }
}

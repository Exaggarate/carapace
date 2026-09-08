import type { DatabaseSync } from "node:sqlite";
import {
  openCarapaceStateDatabase,
  runCarapaceStateWriteTransaction,
  type CarapaceStateDatabaseOptions,
} from "./carapace-state-db.js";
import { CARAPACE_STATE_SCHEMA_SQL } from "./carapace-state-schema.js";

/** Prepare canonical DDL without opening a database; each feature keeps its own handle cache. */
export function createCarapaceStateSchemaEnsurer(params: {
  table: string;
  endMarker?: string;
  operationLabel: string;
}): (options?: CarapaceStateDatabaseOptions) => void {
  const start = CARAPACE_STATE_SCHEMA_SQL.indexOf(
    `\nCREATE TABLE IF NOT EXISTS ${params.table} (\n`,
  );
  const endMarker = params.endMarker ?? "\n) STRICT;\n";
  const end = CARAPACE_STATE_SCHEMA_SQL.indexOf(endMarker, start);
  if (start < 0 || end < start) {
    throw new Error(`Canonical state schema markers are missing for ${params.table}`);
  }
  const schema = CARAPACE_STATE_SCHEMA_SQL.slice(start, end + endMarker.length);
  const ensuredDatabases = new WeakSet<DatabaseSync>();
  return (options = {}) => {
    const database = openCarapaceStateDatabase(options);
    if (ensuredDatabases.has(database.db)) {
      return;
    }
    runCarapaceStateWriteTransaction(
      ({ db }) => {
        db.exec(schema); // sqlite-allow-raw -- Canonical feature-local additive DDL only.
      },
      options,
      { operationLabel: params.operationLabel },
    );
    // Preserve successful wrapper-return timing, including nested savepoints.
    ensuredDatabases.add(database.db);
  };
}

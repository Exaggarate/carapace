// Machine-owned values retired from carapace.json live in the shared state database.
import type { DatabaseSync } from "node:sqlite";
import { executeSqliteQueryTakeFirstSync, getNodeSqliteKysely } from "../infra/kysely-sync.js";
import type { CarapaceStateDatabaseOptions } from "./carapace-state-db-contract.js";
import {
  withExistingCarapaceStateDatabaseArtifactPreservingReadOnly,
  withExistingCarapaceStateDatabaseReadOnly,
} from "./carapace-state-db-readonly.js";
import { tableExists } from "./carapace-state-db-schema-helpers.js";
import type { DB as CarapaceStateKyselyDatabase } from "./carapace-state-db.generated.js";

export type ConfigMachineStateDatabase = Pick<CarapaceStateKyselyDatabase, "config_machine_state">;

export function normalizeConfigMachineStateKey(key: string): string {
  const normalized = key.trim();
  if (!normalized) {
    throw new Error("config machine state key must not be empty");
  }
  return normalized;
}

// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- Callers own the JSON shape for open-ended state keys.
export function readConfigMachineStateWithMetadata<T>(
  key: string,
  options: CarapaceStateDatabaseOptions = {},
  behavior: { artifactPreservingReadOnly?: boolean } = {},
): { value: T; updatedAtMs: number } | undefined {
  const read = ({ db: database }: { db: DatabaseSync }) => {
    if (!tableExists(database, "config_machine_state")) {
      return undefined;
    }
    const db = getNodeSqliteKysely<ConfigMachineStateDatabase>(database);
    const row = executeSqliteQueryTakeFirstSync(
      database,
      db
        .selectFrom("config_machine_state")
        .select(["value_json", "updated_at_ms"])
        .where("state_key", "=", normalizeConfigMachineStateKey(key)),
    );
    return row
      ? { value: JSON.parse(row.value_json) as T, updatedAtMs: row.updated_at_ms }
      : undefined;
  };
  return behavior.artifactPreservingReadOnly
    ? withExistingCarapaceStateDatabaseArtifactPreservingReadOnly(read, options)
    : withExistingCarapaceStateDatabaseReadOnly(read, options);
}

// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- Callers own the JSON shape for open-ended state keys.
export function readConfigMachineState<T>(
  key: string,
  options: CarapaceStateDatabaseOptions = {},
  behavior: { artifactPreservingReadOnly?: boolean } = {},
): T | undefined {
  return readConfigMachineStateWithMetadata<T>(key, options, behavior)?.value;
}

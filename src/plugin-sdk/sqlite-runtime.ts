// Narrow SQLite schema, path, and transaction helpers for first-party runtime.

export type { Generated, Selectable } from "kysely";

export {
  borrowCarapaceAgentDatabase,
  ensureCarapaceAgentDatabaseSchema,
  openCarapaceAgentDatabase,
  resolveCarapaceAgentSqlitePath,
} from "../state/carapace-agent-db.js";
export { withCarapaceAgentDatabaseReadOnly } from "../state/carapace-agent-db-readonly.js";
export { assertCarapaceAgentDatabaseForMaintenance } from "../state/carapace-agent-db-maintenance.js";
export { ensureCarapaceAgentStandingIntentsSchema } from "../state/carapace-agent-standing-intents-schema.js";
export {
  compileSqliteQueryBindings,
  executeSqliteQuerySync,
  executeSqliteQueryTakeFirstSync,
  getNodeSqliteKysely,
  iterateSqliteQuerySync,
  sqliteStringSet,
} from "../infra/kysely-sync.js";
export { openNodeSqliteDatabase } from "../infra/node-sqlite.js";
export { prepareSqliteReadOnlyLocationSync } from "../infra/sqlite-readonly-location.js";
export {
  runSqliteImmediateTransaction,
  runSqliteImmediateTransactionSync,
} from "../infra/sqlite-transaction.js";
export { tableExists } from "../state/carapace-state-db-schema-helpers.js";

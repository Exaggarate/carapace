import { asOptionalRecord, readStringField } from "@carapace/normalization-core/record-coerce";
import { executeSqliteQueryTakeFirstSync } from "../../infra/kysely-sync.js";
import type { CarapaceAgentDatabase } from "../../state/carapace-agent-db.js";
import { getSessionKysely } from "./session-accessor.sqlite-scope.js";

// Collaboration guards need only the node/entry link, without full entry normalization.
// Decode raw JSON in JS so malformed JSON and duplicate keys retain their existing meaning.
export function readSessionEntryInstanceId(
  database: Pick<CarapaceAgentDatabase, "db">,
  sessionKey: string,
): string | undefined {
  const row = executeSqliteQueryTakeFirstSync(
    database.db,
    getSessionKysely(database.db)
      .selectFrom("session_nodes")
      .select(["current_session_id", "entry_json"])
      .where("session_key", "=", sessionKey),
  );
  if (!row?.entry_json) {
    return undefined;
  }
  try {
    const sessionId = readStringField(asOptionalRecord(JSON.parse(row.entry_json)), "sessionId");
    return sessionId === row.current_session_id ? sessionId : undefined;
  } catch {
    return undefined;
  }
}

import { existsSync } from "node:fs";
import { executeSqliteQuerySync, getNodeSqliteKysely } from "../infra/kysely-sync.js";
import type { DB } from "./carapace-state-db.generated.js";
import {
  runCarapaceStateWriteTransaction,
  type CarapaceStateDatabaseOptions,
} from "./carapace-state-db.js";
import { resolveCarapaceStateSqlitePath } from "./carapace-state-db.paths.js";

/** Records an explicit non-Claw claim through the canonical MCP owner. */
export function markClawMcpServerIndependentlyOwned(
  name: string,
  options: CarapaceStateDatabaseOptions & { nowMs?: number } = {},
): number {
  const databasePath = options.path ?? resolveCarapaceStateSqlitePath(options.env ?? process.env);
  if (!existsSync(databasePath)) {
    return 0;
  }
  try {
    return runCarapaceStateWriteTransaction(({ db }) => {
      const result = executeSqliteQuerySync(
        db,
        getNodeSqliteKysely<Pick<DB, "claw_mcp_server_refs">>(db)
          .updateTable("claw_mcp_server_refs")
          .set({ independent_owner: 1, updated_at_ms: options.nowMs ?? Date.now() })
          .where("name", "=", name)
          .where("independent_owner", "!=", 1),
      );
      return Number(result.numAffectedRows);
    }, options);
  } catch {
    // The canonical MCP write already succeeded; Claw status still detects config drift.
    return 0;
  }
}

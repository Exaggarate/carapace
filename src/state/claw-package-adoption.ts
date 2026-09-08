import { existsSync } from "node:fs";
import { executeSqliteQuerySync, getNodeSqliteKysely } from "../infra/kysely-sync.js";
import type { DB } from "./carapace-state-db.generated.js";
import {
  runCarapaceStateWriteTransaction,
  type CarapaceStateDatabaseOptions,
} from "./carapace-state-db.js";
import { resolveCarapaceStateSqlitePath } from "./carapace-state-db.paths.js";

type ClawPackageAdoption = {
  kind: "skill" | "plugin";
  source: "clawhub";
  ref: string;
  version?: string;
  workspace?: string;
};

/** Records an explicit non-Claw claim through the canonical package owner. */
export function markClawPackageIndependentlyOwned(
  artifact: ClawPackageAdoption,
  options: CarapaceStateDatabaseOptions & { nowMs?: number } = {},
): number {
  const databasePath = options.path ?? resolveCarapaceStateSqlitePath(options.env ?? process.env);
  if (!existsSync(databasePath)) {
    return 0;
  }
  const nowMs = options.nowMs ?? Date.now();
  try {
    return runCarapaceStateWriteTransaction(({ db }) => {
      const kysely = getNodeSqliteKysely<Pick<DB, "claw_package_refs" | "claw_installs">>(db);
      let query = kysely
        .updateTable("claw_package_refs")
        .set({ independent_owner: 1, updated_at_ms: nowMs })
        .where("package_kind", "=", artifact.kind)
        .where("package_source", "=", artifact.source)
        .where("package_ref", "=", artifact.ref)
        .where("independent_owner", "!=", 1);
      if (artifact.version) {
        query = query.where("package_version", "=", artifact.version);
      }
      if (artifact.kind === "skill") {
        query = query.where(
          "agent_id",
          "in",
          kysely
            .selectFrom("claw_installs")
            .select("agent_id")
            .where("workspace", "=", artifact.workspace ?? ""),
        );
      }
      return Number(executeSqliteQuerySync(db, query).numAffectedRows);
    }, options);
  } catch {
    // The canonical install already succeeded. Removal also checks its newer owner timestamp.
    return 0;
  }
}

import { chmodSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { resolveSqliteDatabaseFilePaths } from "../infra/sqlite-files.js";
import type { CarapaceAgentDatabaseOptions } from "./carapace-agent-db-contract.js";
import { resolveCarapaceAgentSqlitePath } from "./carapace-agent-db.paths.js";

const CARAPACE_AGENT_DB_DIR_MODE = 0o700;
const CARAPACE_AGENT_DB_FILE_MODE = 0o600;

export function ensureCarapaceAgentDatabasePermissions(
  pathname: string,
  options: CarapaceAgentDatabaseOptions,
): void {
  const dir = path.dirname(pathname);
  const defaultPath = resolveCarapaceAgentSqlitePath({
    agentId: options.agentId,
    env: options.env,
  });
  const isDefaultAgentDatabase = path.resolve(pathname) === path.resolve(defaultPath);
  const dirExisted = existsSync(dir);
  mkdirSync(dir, { recursive: true, mode: CARAPACE_AGENT_DB_DIR_MODE });
  // Default agent state is private by contract; custom pre-existing dirs keep caller ownership.
  if (isDefaultAgentDatabase || !dirExisted) {
    chmodSync(dir, CARAPACE_AGENT_DB_DIR_MODE);
  }
  for (const candidate of resolveSqliteDatabaseFilePaths(pathname)) {
    try {
      chmodSync(candidate, CARAPACE_AGENT_DB_FILE_MODE);
    } catch (error) {
      // WAL/SHM/journal sidecars are transient: SQLite removes them at
      // checkpoint/close, so a concurrent worker can race this sweep. A
      // vanished sidecar needs no tightening; an existsSync guard would just
      // reintroduce the TOCTOU window.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }
}

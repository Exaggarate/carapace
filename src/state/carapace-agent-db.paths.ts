// Agent database path helpers resolve per-agent persisted database paths.
import path from "node:path";
import { normalizeAgentId } from "../routing/session-key.js";
import { resolveCarapaceStateSqliteDir } from "./carapace-state-db.paths.js";

/**
 * Path helpers for per-agent SQLite state.
 *
 * Agent databases live beside the shared state database root so each agent can
 * own private runtime tables while the shared registry can still discover them.
 */
/** Inputs for resolving one agent SQLite path or directory. */
type CarapaceAgentSqlitePathOptions = {
  agentId: string;
  env?: NodeJS.ProcessEnv;
  path?: string;
};

const INCOGNITO_AGENT_SQLITE_BASENAME = "incognito-carapace-agent.sqlite";

/** Resolve the SQLite file for one normalized agent id. */
export function resolveCarapaceAgentSqlitePath(options: CarapaceAgentSqlitePathOptions): string {
  const agentId = normalizeAgentId(options.agentId);
  return path.resolve(
    options.path ??
      path.join(
        path.dirname(resolveCarapaceStateSqliteDir(options.env ?? process.env)),
        "agents",
        agentId,
        "agent",
        "carapace-agent.sqlite",
      ),
  );
}

/** Resolve the lexical sentinel path that keys one agent's process-held incognito database. */
export function resolveIncognitoCarapaceAgentSqlitePath(
  options: Omit<CarapaceAgentSqlitePathOptions, "path">,
): string {
  return path.join(
    path.dirname(resolveCarapaceAgentSqlitePath(options)),
    INCOGNITO_AGENT_SQLITE_BASENAME,
  );
}

/** Identify the reserved incognito sentinel without touching its filesystem path. */
export function isIncognitoCarapaceAgentSqlitePath(
  pathname: string,
  options: Omit<CarapaceAgentSqlitePathOptions, "path">,
): boolean {
  return path.resolve(pathname) === resolveIncognitoCarapaceAgentSqlitePath(options);
}

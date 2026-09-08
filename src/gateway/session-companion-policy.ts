import type { CarapaceConfig } from "../config/types.carapace.js";

export const SESSION_COMPANION_TOOLS = ["read", "sessions_history", "sessions_search"] as const;

export function buildSessionCompanionRunConfig(cfg: CarapaceConfig): CarapaceConfig {
  const toolSearch = cfg.tools?.toolSearch;
  return {
    ...cfg,
    tools: {
      ...cfg.tools,
      sessions: { ...cfg.tools?.sessions, visibility: "self" },
      fs: { ...cfg.tools?.fs, workspaceOnly: true },
      toolSearch: { ...(typeof toolSearch === "object" ? toolSearch : {}), enabled: false },
    },
  };
}

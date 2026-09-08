import path from "node:path";
import { resolveAgentDir } from "../../agents/agent-scope-config.js";
import type { CarapaceConfig } from "../../config/types.carapace.js";

export function resolveWorkshopSkillsDir(
  config: CarapaceConfig,
  agentId: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveAgentDir(config, agentId, env), "workshop-skills");
}

export function resolveWorkshopWatchRoots(config?: CarapaceConfig, agentId?: string) {
  return config && agentId
    ? [{ path: resolveWorkshopSkillsDir(config, agentId), source: "carapace-workshop" }]
    : [];
}

export function createWorkshopWatcherKey(
  workspaceDir: string,
  params: { executionSkillsDir?: string; agentId?: string },
): string {
  return JSON.stringify([workspaceDir, params.executionSkillsDir, params.agentId]);
}

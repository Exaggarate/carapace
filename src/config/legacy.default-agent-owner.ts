import { normalizeAgentId } from "@carapace/normalization-core/agent-id";
import { tryResolveLegacyCompatibilityAgentId } from "../agents/agent-scope-config.js";
import {
  getRetainedLegacyDefaultAgentId,
  setRetainedLegacyDefaultAgentId,
} from "./legacy.default-agent-owner-state.js";
import type { CarapaceConfig } from "./types.carapace.js";

export function retainLegacyDefaultAgentId(
  config: CarapaceConfig,
  agentId: string | undefined,
): CarapaceConfig {
  setRetainedLegacyDefaultAgentId(config, agentId ? normalizeAgentId(agentId) : undefined);
  return config;
}

export function inheritLegacyDefaultAgentId(
  source: CarapaceConfig,
  target: CarapaceConfig,
): CarapaceConfig {
  return retainLegacyDefaultAgentId(target, tryGetLegacyDefaultAgentId(source));
}

export function tryGetLegacyDefaultAgentId(config: CarapaceConfig): string | undefined {
  return getRetainedLegacyDefaultAgentId(config);
}
export { tryResolveLegacyCompatibilityAgentId } from "../agents/agent-scope-config.js";

export function resolveSessionStoreCompatibilityAgentId(config: CarapaceConfig): string {
  const persistedAgentId = config.agents?.defaults?.sessionStore?.agentId?.trim();
  return persistedAgentId
    ? normalizeAgentId(persistedAgentId)
    : (tryResolveLegacyCompatibilityAgentId(config) ?? "main");
}

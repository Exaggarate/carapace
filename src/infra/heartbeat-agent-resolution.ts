import { tryResolveAmbientOwnerAgentId } from "../agents/agent-scope-config.js";
import type { CarapaceConfig } from "../config/types.carapace.js";

export function tryResolveAmbientHeartbeatAgentId(cfg: CarapaceConfig): string | undefined {
  return tryResolveAmbientOwnerAgentId(cfg, cfg.agents?.defaults?.heartbeat?.agentId);
}

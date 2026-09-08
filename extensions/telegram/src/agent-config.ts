// Telegram helper module supports agent config behavior.
import { resolveAgentConfig } from "carapace/plugin-sdk/agent-scope-runtime";
import type { CarapaceConfig } from "carapace/plugin-sdk/config-contracts";

type ReasoningDefault = "on" | "stream" | "off";

export function resolveTelegramConfigReasoningDefault(
  cfg: CarapaceConfig,
  agentId: string,
): ReasoningDefault {
  const agentDefault = resolveAgentConfig(cfg, agentId)?.reasoningDefault;
  return agentDefault ?? cfg.agents?.defaults?.reasoningDefault ?? "off";
}

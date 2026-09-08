import type { CarapaceConfig } from "carapace/plugin-sdk/config-contracts";
import { resolveAgentRoute } from "carapace/plugin-sdk/routing";

/** Resolves the agent that owns account-scoped Telegram runtime state. */
export function resolveTelegramAccountOwnerAgentId(params: {
  cfg: CarapaceConfig;
  accountId?: string | null;
}): string {
  return resolveAgentRoute({
    cfg: params.cfg,
    channel: "telegram",
    accountId: params.accountId,
  }).agentId;
}

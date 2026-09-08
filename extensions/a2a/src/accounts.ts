import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "carapace/plugin-sdk/account-id";
import type { CarapaceConfig } from "carapace/plugin-sdk/config-contracts";
import type { A2aChannelConfig, ResolvedA2aChannelAccount } from "./types.js";

export function listA2aChannelAccountIds(cfg: CarapaceConfig): string[] {
  return cfg.channels?.a2a ? [DEFAULT_ACCOUNT_ID] : [];
}

export function resolveDefaultA2aChannelAccountId(): string {
  return DEFAULT_ACCOUNT_ID;
}

export function resolveA2aChannelAccount(params: {
  cfg: CarapaceConfig;
  accountId?: string | null;
}): ResolvedA2aChannelAccount {
  const config: A2aChannelConfig = params.cfg.channels?.a2a ?? {};
  return {
    accountId: normalizeAccountId(params.accountId),
    enabled: config.enabled !== false,
    configured: Object.keys(config.peers ?? {}).length > 0,
    config,
  };
}

export { DEFAULT_ACCOUNT_ID };

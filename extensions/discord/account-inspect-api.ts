// Discord API module exposes the plugin public contract.
import type { CarapaceConfig } from "carapace/plugin-sdk/config-contracts";
import { inspectDiscordAccount } from "./src/account-inspect.js";

export function inspectDiscordReadOnlyAccount(cfg: CarapaceConfig, accountId?: string | null) {
  return inspectDiscordAccount({ cfg, accountId });
}

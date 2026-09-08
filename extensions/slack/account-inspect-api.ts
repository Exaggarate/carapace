// Slack API module exposes the plugin public contract.
import type { CarapaceConfig } from "carapace/plugin-sdk/config-contracts";
import { inspectSlackAccount } from "./src/account-inspect.js";

export function inspectSlackReadOnlyAccount(cfg: CarapaceConfig, accountId?: string | null) {
  return inspectSlackAccount({ cfg, accountId });
}

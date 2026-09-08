// Telegram API module exposes the plugin public contract.
import type { CarapaceConfig } from "./runtime-api.js";
import { inspectTelegramAccount } from "./src/account-inspect.js";

export function inspectTelegramReadOnlyAccount(cfg: CarapaceConfig, accountId?: string | null) {
  return inspectTelegramAccount({ cfg, accountId });
}

// Line API module exposes the plugin public contract.
export {
  DEFAULT_ACCOUNT_ID,
  formatDocsLink,
  setSetupChannelEnabled,
  splitSetupEntries,
} from "carapace/plugin-sdk/setup";
export type { ChannelSetupWizard } from "carapace/plugin-sdk/setup";
export { listLineAccountIds, normalizeAccountId, resolveLineAccount } from "./accounts.js";

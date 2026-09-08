export type { ChannelMessageActionAdapter } from "carapace/plugin-sdk/channel-contract";
export type { CarapaceConfig } from "carapace/plugin-sdk/config-contracts";
export { buildChannelConfigSchema, SignalConfigSchema } from "./config-api.js";
export { PAIRING_APPROVED_MESSAGE } from "carapace/plugin-sdk/channel-status";
export type { ChannelPlugin, CarapacePluginApi, PluginRuntime } from "carapace/plugin-sdk/core";
export {
  DEFAULT_ACCOUNT_ID,
  applyAccountNameToChannelSection,
  deleteAccountFromConfigSection,
  emptyPluginConfigSchema,
  formatPairingApproveHint,
  getChatChannelMeta,
  migrateBaseNameToDefaultAccount,
  normalizeAccountId,
  setAccountEnabledInConfigSection,
} from "carapace/plugin-sdk/core";
export { resolveChannelMediaMaxBytes } from "carapace/plugin-sdk/account-helpers";
export { formatCliCommand, formatDocsLink } from "carapace/plugin-sdk/setup-tools";
export { chunkText } from "carapace/plugin-sdk/reply-runtime";
export { detectBinary } from "carapace/plugin-sdk/setup-tools";
export {
  resolveAllowlistProviderRuntimeGroupPolicy,
  resolveDefaultGroupPolicy,
} from "carapace/plugin-sdk/runtime-group-policy";
export {
  buildBaseAccountStatusSnapshot,
  buildBaseChannelStatusSummary,
  collectStatusIssuesFromLastError,
  createDefaultChannelRuntimeState,
} from "carapace/plugin-sdk/status-helpers";
export { normalizeE164 } from "carapace/plugin-sdk/text-utility-runtime";
export { looksLikeSignalTargetId, normalizeSignalMessagingTarget } from "./src/normalize.js";
export {
  listEnabledSignalAccounts,
  listSignalAccountIds,
  resolveDefaultSignalAccountId,
  resolveSignalAccount,
} from "./src/accounts.js";
export { monitorSignalProvider } from "./src/monitor.js";
export { installSignalCli } from "./src/install-signal-cli.js";
export { probeSignal } from "./src/probe.js";
export { resolveSignalReactionLevel } from "./src/reaction-level.js";
export { removeReactionSignal, sendReactionSignal } from "./src/send-reactions.js";
export { sendMessageSignal } from "./src/send.js";
export { signalMessageActions } from "./src/message-actions.js";
export type { ResolvedSignalAccount } from "./src/accounts.js";
export type { SignalAccountConfig } from "./src/account-types.js";
export { setSignalRuntime } from "./src/runtime.js";

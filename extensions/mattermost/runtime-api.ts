// Private runtime barrel for the bundled Mattermost extension.
// Keep this barrel thin and generic-only.

export type {
  BaseProbeResult,
  ChannelAccountSnapshot,
  ChannelDirectoryEntry,
  ChannelGroupContext,
  ChannelMessageActionName,
  ChannelPlugin,
  ChatType,
  HistoryEntry,
  CarapaceConfig,
  CarapacePluginApi,
  PluginRuntime,
} from "carapace/plugin-sdk/core";
export type { RuntimeEnv } from "carapace/plugin-sdk/runtime";
export type { ReplyPayload } from "carapace/plugin-sdk/reply-runtime";
export type { ModelsProviderData } from "carapace/plugin-sdk/models-provider-runtime";
export type {
  BlockStreamingCoalesceConfig,
  ContextVisibilityMode,
  DmPolicy,
  GroupPolicy,
} from "carapace/plugin-sdk/config-contracts";
export {
  DEFAULT_ACCOUNT_ID,
  buildChannelConfigSchema,
  createDedupeCache,
  parseStrictPositiveInteger,
  resolveClientIp,
  isTrustedProxyAddress,
} from "carapace/plugin-sdk/core";
export { buildComputedAccountStatusSnapshot } from "carapace/plugin-sdk/channel-status";
export { createAccountStatusSink } from "carapace/plugin-sdk/channel-outbound";
export {
  listSkillCommandsForAgents,
  resolveControlCommandGate,
  resolveStoredModelOverride,
} from "carapace/plugin-sdk/command-auth-native";
export { buildPreparedModelsProviderData } from "carapace/plugin-sdk/models-provider-runtime";
export {
  GROUP_POLICY_BLOCKED_LABEL,
  resolveAllowlistProviderRuntimeGroupPolicy,
  resolveDefaultGroupPolicy,
  warnMissingProviderGroupPolicyFallbackOnce,
} from "carapace/plugin-sdk/runtime-group-policy";
export { isDangerousNameMatchingEnabled } from "carapace/plugin-sdk/dangerous-name-runtime";
export { resolveStorePath } from "carapace/plugin-sdk/session-store-runtime";
export { formatInboundFromLabel } from "carapace/plugin-sdk/channel-inbound";
export { logInboundDrop } from "carapace/plugin-sdk/channel-inbound";
export { createChannelPairingController } from "carapace/plugin-sdk/channel-pairing";
export { createChannelMessageReplyPipeline } from "carapace/plugin-sdk/channel-outbound";
export { logTypingFailure } from "carapace/plugin-sdk/channel-feedback";
export { loadOutboundMediaFromUrl } from "carapace/plugin-sdk/outbound-media";
export { rawDataToString } from "carapace/plugin-sdk/webhook-ingress";
export { chunkTextForOutbound } from "carapace/plugin-sdk/text-chunking";
// Legacy map-helper exports stay for older plugin consumers. New message-turn
// code should use createChannelHistoryWindow.
export {
  DEFAULT_GROUP_HISTORY_LIMIT,
  createChannelHistoryWindow,
  buildPendingHistoryContextFromMap,
  clearHistoryEntriesIfEnabled,
  recordPendingHistoryEntryIfEnabled,
} from "carapace/plugin-sdk/reply-history";
export { normalizeAccountId, resolveThreadSessionKeys } from "carapace/plugin-sdk/routing";
export { resolveAllowlistMatchSimple } from "carapace/plugin-sdk/allow-from";
export { registerPluginHttpRoute } from "carapace/plugin-sdk/webhook-targets";
export {
  isRequestBodyLimitError,
  readRequestBodyWithLimit,
} from "carapace/plugin-sdk/webhook-ingress";
export {
  applyAccountNameToChannelSection,
  applySetupAccountConfigPatch,
  migrateBaseNameToDefaultAccount,
} from "carapace/plugin-sdk/setup";
export { resolveChannelMediaMaxBytes } from "carapace/plugin-sdk/account-helpers";
export { getAgentScopedMediaLocalRoots } from "carapace/plugin-sdk/media-runtime";
export { normalizeProviderId } from "carapace/plugin-sdk/provider-model-shared";
export { setMattermostRuntime } from "./src/runtime.js";

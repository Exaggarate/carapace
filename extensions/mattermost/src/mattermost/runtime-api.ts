// Mattermost API module exposes the plugin public contract.
export type {
  BaseProbeResult,
  ChannelAccountSnapshot,
  ChannelDirectoryEntry,
  ChatType,
  HistoryEntry,
  CarapaceConfig,
  CarapacePluginApi,
  ReplyPayload,
} from "carapace/plugin-sdk/core";
export type { RuntimeEnv } from "carapace/plugin-sdk/runtime";
export { resolveAllowlistMatchSimple } from "carapace/plugin-sdk/allow-from";
export { logInboundDrop } from "carapace/plugin-sdk/channel-inbound";
export { createChannelPairingController } from "carapace/plugin-sdk/channel-pairing";
export { createChannelMessageReplyPipeline } from "carapace/plugin-sdk/channel-outbound";
export { logTypingFailure } from "carapace/plugin-sdk/channel-feedback";
export { listSkillCommandsForAgents } from "carapace/plugin-sdk/command-auth-native";
export { buildPreparedModelsProviderData } from "carapace/plugin-sdk/models-provider-runtime";
export { isDangerousNameMatchingEnabled } from "carapace/plugin-sdk/dangerous-name-runtime";
export {
  resolveAllowlistProviderRuntimeGroupPolicy,
  resolveDefaultGroupPolicy,
  warnMissingProviderGroupPolicyFallbackOnce,
} from "carapace/plugin-sdk/runtime-group-policy";
export { resolveChannelMediaMaxBytes } from "carapace/plugin-sdk/account-helpers";
export { loadOutboundMediaFromUrl } from "carapace/plugin-sdk/outbound-media";
// Legacy map-helper exports stay for older plugin consumers. New message-turn
// code should use createChannelHistoryWindow.
export {
  DEFAULT_GROUP_HISTORY_LIMIT,
  createChannelHistoryWindow,
} from "carapace/plugin-sdk/reply-history";
export { registerPluginHttpRoute } from "carapace/plugin-sdk/webhook-targets";
export { isRequestBodyLimitError } from "carapace/plugin-sdk/webhook-ingress";
export {
  readRequestBodyWithLimit,
  sendHttpRequestRejection,
} from "carapace/plugin-sdk/webhook-request-guards";
export { isTrustedProxyAddress, resolveClientIp } from "carapace/plugin-sdk/core";

// Private runtime barrel for the bundled Google Chat extension.
// Keep this barrel thin and avoid broad plugin-sdk surfaces during bootstrap.

export { DEFAULT_ACCOUNT_ID } from "carapace/plugin-sdk/account-id";
export {
  createActionGate,
  jsonResult,
  readNumberParam,
  readReactionParams,
  readStringParam,
} from "carapace/plugin-sdk/channel-actions";
export { buildChannelConfigSchema, GoogleChatConfigSchema } from "./config-api.js";
export type {
  ChannelMessageActionAdapter,
  ChannelMessageActionName,
  ChannelStatusIssue,
} from "carapace/plugin-sdk/channel-contract";
export { missingTargetError } from "carapace/plugin-sdk/channel-feedback";
export {
  createAccountStatusSink,
  runPassiveAccountLifecycle,
} from "carapace/plugin-sdk/channel-outbound";
export { createChannelPairingController } from "carapace/plugin-sdk/channel-pairing";
export { createChannelMessageReplyPipeline } from "carapace/plugin-sdk/channel-outbound";
export { PAIRING_APPROVED_MESSAGE } from "carapace/plugin-sdk/channel-status";
export { chunkTextForOutbound } from "carapace/plugin-sdk/text-chunking";
export type { CarapaceConfig } from "carapace/plugin-sdk/config-contracts";
export {
  GROUP_POLICY_BLOCKED_LABEL,
  resolveAllowlistProviderRuntimeGroupPolicy,
  resolveDefaultGroupPolicy,
  warnMissingProviderGroupPolicyFallbackOnce,
} from "carapace/plugin-sdk/runtime-group-policy";
export { isDangerousNameMatchingEnabled } from "carapace/plugin-sdk/dangerous-name-runtime";
export type { PluginRuntime } from "carapace/plugin-sdk/runtime-store";
export { fetchWithSsrFGuard } from "carapace/plugin-sdk/ssrf-runtime";
export type {
  GoogleChatAccountConfig,
  GoogleChatConfig,
} from "carapace/plugin-sdk/config-contracts";
export { extractToolSend } from "carapace/plugin-sdk/tool-send";
export { resolveInboundMentionDecision } from "carapace/plugin-sdk/channel-inbound";
export { resolveWebhookPath } from "carapace/plugin-sdk/webhook-ingress";
export {
  registerWebhookTargetWithPluginRoute,
  resolveWebhookTargetWithAuthOrReject,
  withResolvedWebhookRequestPipeline,
} from "carapace/plugin-sdk/webhook-targets";
export {
  createWebhookInFlightLimiter,
  readJsonWebhookBodyOrReject,
  type WebhookInFlightLimiter,
} from "carapace/plugin-sdk/webhook-request-guards";
export { setGoogleChatRuntime } from "./src/runtime.js";

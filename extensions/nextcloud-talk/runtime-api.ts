// Private runtime barrel for the bundled Nextcloud Talk extension.
// Keep this barrel thin and aligned with the local extension surface.

export type { AllowlistMatch } from "carapace/plugin-sdk/allow-from";
export type { ChannelGroupContext } from "carapace/plugin-sdk/channel-contract";
export { logInboundDrop } from "carapace/plugin-sdk/channel-inbound";
export { createChannelPairingController } from "carapace/plugin-sdk/channel-pairing";
export type {
  BlockStreamingCoalesceConfig,
  DmConfig,
  DmPolicy,
  GroupPolicy,
  GroupToolPolicyConfig,
  CarapaceConfig,
} from "carapace/plugin-sdk/config-contracts";
export {
  GROUP_POLICY_BLOCKED_LABEL,
  resolveAllowlistProviderRuntimeGroupPolicy,
  resolveDefaultGroupPolicy,
  warnMissingProviderGroupPolicyFallbackOnce,
} from "carapace/plugin-sdk/runtime-group-policy";
export { createChannelMessageReplyPipeline } from "carapace/plugin-sdk/channel-outbound";
export type { OutboundReplyPayload } from "carapace/plugin-sdk/reply-payload";
export { deliverFormattedTextWithAttachments } from "carapace/plugin-sdk/reply-payload";
export type { PluginRuntime } from "carapace/plugin-sdk/runtime-store";
export type { RuntimeEnv } from "carapace/plugin-sdk/runtime";
export type { SecretInput } from "carapace/plugin-sdk/secret-input";
export { fetchWithSsrFGuard } from "carapace/plugin-sdk/ssrf-runtime";
export { setNextcloudTalkRuntime } from "./src/runtime.js";

// Private runtime barrel for the bundled Microsoft Teams extension.
// Keep this barrel thin and aligned with the local extension surface.

export { DEFAULT_ACCOUNT_ID } from "carapace/plugin-sdk/account-id";
export type { AllowlistMatch } from "carapace/plugin-sdk/allow-from";
export {
  mergeAllowlist,
  resolveAllowlistMatchSimple,
  summarizeMapping,
} from "carapace/plugin-sdk/allow-from";
export type {
  BaseProbeResult,
  ChannelDirectoryEntry,
  ChannelGroupContext,
  ChannelMessageActionName,
  ChannelOutboundAdapter,
} from "carapace/plugin-sdk/channel-contract";
export type { ChannelPlugin } from "carapace/plugin-sdk/channel-core";
export { logTypingFailure } from "carapace/plugin-sdk/channel-outbound";
export { createChannelPairingController } from "carapace/plugin-sdk/channel-pairing";
export { resolveToolsBySender } from "carapace/plugin-sdk/channel-policy";
export { createChannelMessageReplyPipeline } from "carapace/plugin-sdk/channel-outbound";
export {
  PAIRING_APPROVED_MESSAGE,
  buildProbeChannelStatusSummary,
  createDefaultChannelRuntimeState,
} from "carapace/plugin-sdk/channel-status";
export {
  buildChannelKeyCandidates,
  normalizeChannelSlug,
  resolveChannelEntryMatchWithFallback,
  resolveNestedAllowlistDecision,
} from "carapace/plugin-sdk/channel-targets";
export type {
  GroupPolicy,
  GroupToolPolicyConfig,
  MSTeamsChannelConfig,
  MSTeamsCloudName,
  MSTeamsConfig,
  MSTeamsReplyStyle,
  MSTeamsTeamConfig,
  MarkdownTableMode,
  CarapaceConfig,
} from "carapace/plugin-sdk/config-contracts";
export { isDangerousNameMatchingEnabled } from "carapace/plugin-sdk/dangerous-name-runtime";
export { resolveDefaultGroupPolicy } from "carapace/plugin-sdk/runtime-group-policy";
export { withFileLock } from "carapace/plugin-sdk/file-lock";
export { keepHttpServerTaskAlive } from "carapace/plugin-sdk/channel-outbound";
export {
  detectMime,
  extensionForMime,
  extractOriginalFilename,
  getFileExtension,
} from "carapace/plugin-sdk/media-runtime";
export { resolveChannelMediaMaxBytes } from "carapace/plugin-sdk/account-helpers";
export { loadOutboundMediaFromUrl } from "carapace/plugin-sdk/outbound-media";
// Deprecated media-legacy-projection surface; the re-export stays until the
// compat record's removeAfter window expires (deleted in retirement PR 4).
export { buildMediaPayload } from "carapace/plugin-sdk/reply-payload";
export type { ReplyPayload } from "carapace/plugin-sdk/reply-payload";
export type { PluginRuntime } from "carapace/plugin-sdk/runtime-store";
export type { RuntimeEnv } from "carapace/plugin-sdk/runtime";
export type { SsrFPolicy } from "carapace/plugin-sdk/ssrf-runtime";
export { fetchWithSsrFGuard } from "carapace/plugin-sdk/ssrf-runtime";
export { normalizeStringEntries } from "carapace/plugin-sdk/string-normalization-runtime";
export { chunkTextForOutbound } from "carapace/plugin-sdk/text-chunking";
export { DEFAULT_WEBHOOK_MAX_BODY_BYTES } from "carapace/plugin-sdk/webhook-ingress";
export { setMSTeamsRuntime } from "./src/runtime.js";

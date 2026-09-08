// Narrow Matrix monitor helper seam.
// Keep monitor internals off the broad package runtime-api barrel so monitor
// tests and shared workers do not pull unrelated Matrix helper surfaces.

export type { NormalizedLocation } from "carapace/plugin-sdk/channel-inbound";
export type { PluginRuntime, RuntimeLogger } from "carapace/plugin-sdk/plugin-runtime";
export type { BlockReplyContext, ReplyPayload } from "carapace/plugin-sdk/reply-runtime";
export type { CarapaceConfig } from "carapace/plugin-sdk/config-contracts";
export type { RuntimeEnv } from "carapace/plugin-sdk/runtime";
export {
  addAllowlistUserEntriesFromConfigEntry,
  buildAllowlistResolutionSummary,
  canonicalizeAllowlistWithResolvedIds,
  patchAllowlistUsersInConfigEntries,
  summarizeMapping,
} from "carapace/plugin-sdk/allow-from";
export {
  createReplyPrefixOptions,
  createTypingCallbacks,
} from "carapace/plugin-sdk/channel-outbound";
export { formatLocationText, toLocationContext } from "carapace/plugin-sdk/channel-inbound";
export { getAgentScopedMediaLocalRoots } from "carapace/plugin-sdk/media-local-roots";
export { logInboundDrop } from "carapace/plugin-sdk/channel-inbound";
export { logTypingFailure } from "carapace/plugin-sdk/channel-outbound";
export { buildChannelKeyCandidates } from "carapace/plugin-sdk/channel-targets";

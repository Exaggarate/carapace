// Whatsapp API module exposes the plugin public contract.
export { resolveIdentityNamePrefix } from "carapace/plugin-sdk/agent-runtime";
export { formatInboundEnvelope } from "carapace/plugin-sdk/channel-inbound";
export { resolveInboundSessionEnvelopeContext } from "carapace/plugin-sdk/channel-inbound";
export { createChannelMessageReplyPipeline } from "carapace/plugin-sdk/channel-outbound";
export {
  isControlCommandMessage,
  shouldComputeCommandAuthorized,
} from "carapace/plugin-sdk/command-detection";
export { resolveChannelContextVisibilityMode } from "../config.runtime.js";
export { getAgentScopedMediaLocalRoots } from "carapace/plugin-sdk/media-runtime";
export type LoadConfigFn = typeof import("../config.runtime.js").getRuntimeConfig;
export {
  buildHistoryContextFromEntries,
  type HistoryEntry,
} from "carapace/plugin-sdk/reply-history";
export { resolveSendableOutboundReplyParts } from "carapace/plugin-sdk/reply-payload";
export {
  resolveChunkMode,
  resolveTextChunkLimit,
  type getReplyFromConfig,
  type ReplyPayload,
} from "carapace/plugin-sdk/reply-runtime";
export {
  resolveInboundLastRouteSessionKey,
  type resolveAgentRoute,
} from "carapace/plugin-sdk/routing";
export { logVerbose, shouldLogVerbose, type getChildLogger } from "carapace/plugin-sdk/runtime-env";
export { resolvePinnedMainDmOwnerFromAllowlist } from "carapace/plugin-sdk/security-runtime";
export { resolveMarkdownTableMode } from "carapace/plugin-sdk/markdown-table-runtime";
export { jidToE164, normalizeE164 } from "../../text-runtime.js";

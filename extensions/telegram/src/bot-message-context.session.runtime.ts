// Telegram plugin module implements bot message context.session behavior.
export { buildChannelInboundEventContext } from "carapace/plugin-sdk/channel-inbound";
export {
  readAmbientTranscriptWatermark,
  readSessionUpdatedAt,
  resolveAmbientTranscriptWatermarkKey,
  resolveStorePath,
} from "carapace/plugin-sdk/session-store-runtime";
export { recordInboundSession } from "carapace/plugin-sdk/conversation-runtime";
export { resolveInboundLastRouteSessionKey } from "carapace/plugin-sdk/routing";
export { resolvePinnedMainDmOwnerFromAllowlist } from "carapace/plugin-sdk/security-runtime";

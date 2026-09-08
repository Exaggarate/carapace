// Telegram plugin module implements send behavior.
export { requireRuntimeConfig } from "carapace/plugin-sdk/plugin-config-runtime";
export { resolveMarkdownTableMode } from "carapace/plugin-sdk/markdown-table-runtime";
export type { CarapaceConfig } from "carapace/plugin-sdk/config-contracts";
export type { PollInput } from "carapace/plugin-sdk/media-runtime";
export {
  buildOutboundMediaLoadOptions,
  getImageMetadata,
  normalizePollInput,
  probeVideoDimensions,
} from "carapace/plugin-sdk/media-runtime";
export { loadWebMedia } from "carapace/plugin-sdk/web-media";

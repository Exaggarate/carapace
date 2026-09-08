// Telegram plugin module implements bot message dispatch behavior.
export { getSessionEntry } from "carapace/plugin-sdk/session-store-runtime";
export { resolveMarkdownTableMode } from "carapace/plugin-sdk/markdown-table-runtime";
export { getAgentScopedMediaLocalRoots } from "carapace/plugin-sdk/media-runtime";
export { resolveChunkMode } from "carapace/plugin-sdk/reply-dispatch-runtime";
export {
  generateTelegramTopicLabel as generateTopicLabel,
  resolveAutoTopicLabelConfig,
} from "./auto-topic-label.js";

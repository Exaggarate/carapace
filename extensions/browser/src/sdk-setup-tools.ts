/**
 * Browser-local SDK setup/tooling bridge for CLI, media, and action helpers.
 */
export {
  callGatewayTool,
  hasGatewayToolRoutingContext,
  listNodes,
  resolveNodeIdFromList,
} from "carapace/plugin-sdk/agent-harness-runtime";
export type { AnyAgentTool } from "carapace/plugin-sdk/agent-harness-runtime";
export {
  imageResultFromFile,
  jsonResult,
  readPositiveIntegerParam,
  readStringParam,
} from "carapace/plugin-sdk/channel-actions";
export { formatCliCommand, note } from "carapace/plugin-sdk/cli-runtime";
export {
  IMAGE_REDUCE_QUALITY_STEPS,
  buildImageResizeSideGrid,
  getImageMetadata,
  isImageProcessorUnavailableError,
  resizeToJpeg,
} from "carapace/plugin-sdk/media-runtime";
export { detectMime } from "carapace/plugin-sdk/media-mime";
export { ensureMediaDir, saveMediaBuffer } from "carapace/plugin-sdk/media-runtime";
export { describeImageFile } from "carapace/plugin-sdk/media-understanding-runtime";

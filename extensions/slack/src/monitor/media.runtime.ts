// Slack plugin module implements media behavior.
import { createSubsystemLogger } from "carapace/plugin-sdk/runtime-env";

export const slackMediaLog = createSubsystemLogger("gateway/channels/slack").child("media");
export { fetchWithRuntimeDispatcher } from "carapace/plugin-sdk/runtime-fetch";
export type { FetchLike } from "carapace/plugin-sdk/media-runtime";
export { saveRemoteMedia } from "carapace/plugin-sdk/media-runtime";

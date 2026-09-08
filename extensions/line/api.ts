// Line API module exposes the plugin public contract.
export type {
  ChannelAccountSnapshot,
  ChannelPlugin,
  CarapaceConfig,
  CarapacePluginApi,
  PluginRuntime,
} from "carapace/plugin-sdk/core";
export type { ReplyPayload } from "carapace/plugin-sdk/reply-runtime";
export type { ResolvedLineAccount } from "./runtime-api.js";
export { linePlugin } from "./src/channel.js";
export { lineSetupPlugin } from "./src/channel.setup.js";

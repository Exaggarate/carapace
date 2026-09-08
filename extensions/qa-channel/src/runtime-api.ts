// Qa Channel API module exposes the plugin public contract.
export type {
  ChannelMessageActionAdapter,
  ChannelMessageActionName,
  ChannelGatewayContext,
} from "carapace/plugin-sdk/channel-contract";
export type { ChannelPlugin } from "carapace/plugin-sdk/channel-core";
export type { CarapaceConfig } from "carapace/plugin-sdk/config-contracts";
export type { RuntimeEnv } from "carapace/plugin-sdk/runtime";
export type { PluginRuntime } from "carapace/plugin-sdk/runtime-store";
export {
  buildChannelConfigSchema,
  buildChannelOutboundSessionRoute,
  createChatChannelPlugin,
  defineChannelPluginEntry,
} from "carapace/plugin-sdk/channel-core";
export { jsonResult, readStringParam } from "carapace/plugin-sdk/channel-actions";
export { getChatChannelMeta } from "carapace/plugin-sdk/channel-plugin-common";
export {
  createComputedAccountStatusAdapter,
  createDefaultChannelRuntimeState,
} from "carapace/plugin-sdk/status-helpers";
export { createPluginRuntimeStore } from "carapace/plugin-sdk/runtime-store";
export { createChannelMessageReplyPipeline } from "carapace/plugin-sdk/channel-outbound";

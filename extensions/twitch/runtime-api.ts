// Private runtime barrel for the bundled Twitch extension.
// Keep this barrel thin and aligned with the local extension surface.

export type {
  ChannelAccountSnapshot,
  ChannelCapabilities,
  ChannelGatewayContext,
  ChannelLogSink,
  ChannelMessageActionAdapter,
  ChannelMessageActionContext,
  ChannelMeta,
  ChannelOutboundAdapter,
  ChannelOutboundContext,
  ChannelResolveKind,
  ChannelResolveResult,
  ChannelStatusAdapter,
} from "carapace/plugin-sdk/channel-contract";
export type { ChannelPlugin } from "carapace/plugin-sdk/channel-core";
export type { OutboundDeliveryResult } from "carapace/plugin-sdk/channel-send-result";
export type { CarapaceConfig } from "carapace/plugin-sdk/config-contracts";
export type { RuntimeEnv } from "carapace/plugin-sdk/runtime";
export type { WizardPrompter } from "carapace/plugin-sdk/setup";

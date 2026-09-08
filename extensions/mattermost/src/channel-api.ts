// Mattermost API module exposes the plugin public contract.
export { createAccountStatusSink } from "carapace/plugin-sdk/channel-outbound";
export type { ChannelPlugin } from "carapace/plugin-sdk/core";
export { DEFAULT_ACCOUNT_ID } from "carapace/plugin-sdk/core";
export { chunkTextForOutbound } from "carapace/plugin-sdk/text-chunking";

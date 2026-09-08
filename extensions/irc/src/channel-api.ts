// Irc API module exposes the plugin public contract.
export { createAccountStatusSink } from "carapace/plugin-sdk/channel-outbound";
export { DEFAULT_ACCOUNT_ID } from "carapace/plugin-sdk/account-id";
export type { ChannelPlugin } from "carapace/plugin-sdk/channel-core";
export { PAIRING_APPROVED_MESSAGE } from "carapace/plugin-sdk/channel-status";
export { buildBaseChannelStatusSummary } from "carapace/plugin-sdk/status-helpers";
export { chunkTextForOutbound } from "carapace/plugin-sdk/text-chunking";

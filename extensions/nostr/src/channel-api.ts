// Nostr API module exposes the plugin public contract.
export {
  buildChannelConfigSchema,
  DEFAULT_ACCOUNT_ID,
  formatPairingApproveHint,
  type ChannelPlugin,
} from "carapace/plugin-sdk/channel-plugin-common";
export type { ChannelOutboundAdapter } from "carapace/plugin-sdk/channel-contract";
export {
  collectStatusIssuesFromLastError,
  createDefaultChannelRuntimeState,
} from "carapace/plugin-sdk/status-helpers";

// Whatsapp plugin module implements group gating behavior.
export {
  implicitMentionKindWhen,
  resolveInboundMentionDecision,
} from "carapace/plugin-sdk/channel-mention-gating";
export { hasControlCommand } from "carapace/plugin-sdk/command-detection";
export { createChannelHistoryWindow } from "carapace/plugin-sdk/reply-history";
export { parseActivationCommand } from "carapace/plugin-sdk/group-activation";
export { normalizeE164 } from "../../text-runtime.js";

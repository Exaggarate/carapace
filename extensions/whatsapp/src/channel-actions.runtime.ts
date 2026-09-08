// Whatsapp plugin module implements channel actions behavior.
import { createActionGate } from "carapace/plugin-sdk/channel-actions";
import type { ChannelMessageActionName } from "carapace/plugin-sdk/channel-contract";
import type { CarapaceConfig } from "carapace/plugin-sdk/config-contracts";

export { listWhatsAppAccountIds, resolveWhatsAppAccount } from "./accounts.js";
export { resolveWhatsAppReactionLevel } from "./reaction-level.js";
export { createActionGate, type ChannelMessageActionName, type CarapaceConfig };

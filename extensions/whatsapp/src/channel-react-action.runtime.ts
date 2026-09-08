// Whatsapp plugin module implements channel react action behavior.
import { readStringOrNumberParam, readStringParam } from "carapace/plugin-sdk/channel-actions";
import type { CarapaceConfig } from "carapace/plugin-sdk/config-contracts";

export { resolveReactionMessageId } from "carapace/plugin-sdk/channel-actions";
export { handleWhatsAppAction } from "./action-runtime.js";
export { resolveAuthorizedWhatsAppOutboundTarget } from "./action-runtime-target-auth.js";
export { resolveWhatsAppAccount, resolveWhatsAppMediaMaxBytes } from "./accounts.js";
export { isWhatsAppGroupJid, normalizeWhatsAppTarget } from "./normalize.js";
export { sendWhatsAppUploadFile as sendMessageWhatsApp } from "./send.js";
export { readStringOrNumberParam, readStringParam, type CarapaceConfig };

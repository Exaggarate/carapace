// Imessage API module exposes the plugin public contract.
import type { CarapaceConfig as RuntimeApiCarapaceConfig } from "carapace/plugin-sdk/config-contracts";

export {
  DEFAULT_ACCOUNT_ID,
  getChatChannelMeta,
  type ChannelPlugin,
} from "carapace/plugin-sdk/core";
export { buildChannelConfigSchema, IMessageConfigSchema } from "./config-api.js";
export { PAIRING_APPROVED_MESSAGE } from "carapace/plugin-sdk/channel-status";
export {
  buildComputedAccountStatusSnapshot,
  collectStatusIssuesFromLastError,
} from "carapace/plugin-sdk/status-helpers";
export { formatTrimmedAllowFromEntries } from "carapace/plugin-sdk/channel-config-helpers";
export {
  resolveIMessageConfigAllowFrom,
  resolveIMessageConfigDefaultTo,
} from "./src/config-accessors.js";
export { looksLikeIMessageTargetId, normalizeIMessageMessagingTarget } from "./src/normalize.js";
export { resolveChannelMediaMaxBytes } from "carapace/plugin-sdk/account-helpers";
export {
  resolveIMessageGroupRequireMention,
  resolveIMessageGroupToolPolicy,
} from "./src/group-policy.js";

export { monitorIMessageProvider } from "./src/monitor.js";
export type { MonitorIMessageOpts } from "./src/monitor.js";
export { probeIMessage } from "./src/probe.js";
export type { IMessageProbe } from "./src/probe.js";
export { sendMessageIMessage } from "./src/send.js";
export { imessageMessageActions } from "./src/actions.js";
export { setIMessageRuntime } from "./src/runtime.js";
export { chunkTextForOutbound } from "carapace/plugin-sdk/text-chunking";
export type IMessageAccountConfig = Omit<
  NonNullable<NonNullable<RuntimeApiCarapaceConfig["channels"]>["imessage"]>,
  "accounts" | "defaultAccount"
>;

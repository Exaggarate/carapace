// Private runtime barrel for the bundled Feishu extension.
// Keep this barrel thin and generic-only.

export type {
  AllowlistMatch,
  AnyAgentTool,
  BaseProbeResult,
  ChannelGroupContext,
  ChannelMessageActionName,
  ChannelMeta,
  ChannelOutboundAdapter,
  ChannelPlugin,
  HistoryEntry,
  CarapaceConfig,
  CarapacePluginApi,
  OutboundIdentity,
  PluginRuntime,
  ReplyPayload,
} from "carapace/plugin-sdk/core";
export type { CarapaceConfig as ClawdbotConfig } from "carapace/plugin-sdk/core";
export type RuntimeEnv = {
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  exit: (code: number) => void;
};
export type { GroupToolPolicyConfig } from "carapace/plugin-sdk/config-contracts";
export {
  DEFAULT_ACCOUNT_ID,
  buildChannelConfigSchema,
  createActionGate,
  createDedupeCache,
} from "carapace/plugin-sdk/core";
export {
  PAIRING_APPROVED_MESSAGE,
  buildProbeChannelStatusSummary,
  createDefaultChannelRuntimeState,
} from "carapace/plugin-sdk/channel-status";
export { createChannelPairingController } from "carapace/plugin-sdk/channel-pairing";
export { createReplyPrefixContext } from "carapace/plugin-sdk/channel-outbound";
export {
  evaluateSupplementalContextVisibility,
  filterSupplementalContextItems,
  resolveChannelContextVisibilityMode,
} from "carapace/plugin-sdk/context-visibility-runtime";
export { getSessionEntry } from "carapace/plugin-sdk/session-store-runtime";
export { readJsonFileWithFallback } from "carapace/plugin-sdk/json-store";
export { normalizeAgentId } from "carapace/plugin-sdk/routing";
export { chunkTextForOutbound } from "carapace/plugin-sdk/text-chunking";
export {
  isRequestBodyLimitError,
  readRequestBodyWithLimit,
  requestBodyErrorToText,
} from "carapace/plugin-sdk/webhook-ingress";
export { setFeishuRuntime } from "./src/runtime.js";

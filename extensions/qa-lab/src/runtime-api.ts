// Qa Lab API module exposes the plugin public contract.
export type { Command } from "commander";
export type { CarapaceConfig } from "carapace/plugin-sdk/config-contracts";
export { definePluginEntry } from "carapace/plugin-sdk/plugin-entry";
export { callGatewayFromCli } from "carapace/plugin-sdk/gateway-runtime";
export type { PluginRuntime } from "carapace/plugin-sdk/runtime-store";
export { defaultQaRuntimeModelForMode } from "./model-selection.runtime.js";
export {
  buildQaTarget,
  createQaBusThread,
  deleteQaBusMessage,
  editQaBusMessage,
  getQaBusState,
  injectQaBusInboundMessage,
  normalizeQaTarget,
  parseQaTarget,
  pollQaBus,
  qaChannelPlugin,
  reactToQaBusMessage,
  readQaBusMessage,
  searchQaBusMessages,
  sendQaBusMessage,
  setQaChannelRuntime,
} from "carapace/plugin-sdk/qa-channel";
export type {
  QaBusAttachment,
  QaBusConversation,
  QaBusCreateThreadInput,
  QaBusDeleteMessageInput,
  QaBusEditMessageInput,
  QaBusEvent,
  QaBusInboundMessageInput,
  QaBusMessage,
  QaBusOutboundMessageInput,
  QaBusPollInput,
  QaBusPollResult,
  QaBusReactToMessageInput,
  QaBusReadMessageInput,
  QaBusSearchMessagesInput,
  QaBusSnapshotConversation,
  QaBusStateSnapshot,
  QaBusThread,
  QaBusToolCall,
  QaBusWaitForInput,
} from "carapace/plugin-sdk/qa-channel-protocol";

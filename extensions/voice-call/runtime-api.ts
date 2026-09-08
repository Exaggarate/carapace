// Private runtime barrel for the bundled Voice Call extension.
// Keep this barrel thin and aligned with the local extension surface.

export { definePluginEntry } from "carapace/plugin-sdk/plugin-entry";
export type { CarapacePluginApi } from "carapace/plugin-sdk/plugin-entry";
export type { GatewayRequestHandlerOptions } from "carapace/plugin-sdk/gateway-runtime";
export {
  isRequestBodyLimitError,
  readRequestBodyWithLimit,
  requestBodyErrorToText,
  sendHttpRequestRejection,
} from "carapace/plugin-sdk/webhook-request-guards";
export { fetchWithSsrFGuard, isBlockedHostnameOrIp } from "carapace/plugin-sdk/ssrf-runtime";
export type { SessionEntry } from "carapace/plugin-sdk/session-store-runtime";
export {
  TtsAutoSchema,
  TtsConfigSchema,
  TtsModeSchema,
  TtsProviderSchema,
} from "carapace/plugin-sdk/tts-runtime";
export { sleep } from "carapace/plugin-sdk/runtime-env";

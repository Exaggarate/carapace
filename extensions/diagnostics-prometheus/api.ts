// Diagnostics Prometheus API module exposes the plugin public contract.
export type {
  DiagnosticEventMetadata,
  DiagnosticEventPayload,
} from "carapace/plugin-sdk/diagnostic-runtime";
export { isInternalDiagnosticEventMetadata } from "carapace/plugin-sdk/diagnostic-runtime";
export {
  emptyPluginConfigSchema,
  type CarapacePluginApi,
  type CarapacePluginHttpRouteHandler,
  type CarapacePluginService,
  type CarapacePluginServiceContext,
} from "carapace/plugin-sdk/plugin-entry";
export { redactSensitiveText } from "carapace/plugin-sdk/security-runtime";

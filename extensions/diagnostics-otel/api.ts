// Diagnostics Otel API module exposes the plugin public contract.
export {
  createChildDiagnosticTraceContext,
  createDiagnosticTraceContext,
  emitDiagnosticEvent,
  formatDiagnosticTraceparent,
  isValidDiagnosticSpanId,
  isValidDiagnosticTraceFlags,
  isValidDiagnosticTraceId,
  onDiagnosticEvent,
  parseDiagnosticTraceparent,
  type DiagnosticEventMetadata,
  type DiagnosticEventPayload,
  type DiagnosticEventPrivateData,
  type DiagnosticTraceContext,
} from "carapace/plugin-sdk/diagnostic-runtime";
export { emptyPluginConfigSchema, type CarapacePluginApi } from "carapace/plugin-sdk/plugin-entry";
export type {
  CarapacePluginService,
  CarapacePluginServiceContext,
} from "carapace/plugin-sdk/plugin-entry";
export { redactSensitiveText } from "carapace/plugin-sdk/security-runtime";

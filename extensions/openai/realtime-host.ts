// Full registration composes the same host operations supplied to a cold capability catalog.
import { resolveAgentDir } from "carapace/plugin-sdk/agent-scope-runtime";
import { formatErrorMessage } from "carapace/plugin-sdk/error-runtime";
import type { PluginCapabilityCatalogContext } from "carapace/plugin-sdk/plugin-entry";
import {
  isProviderAuthProfileConfigured,
  resolveProviderAuthProfileApiKey,
} from "carapace/plugin-sdk/provider-auth";
import {
  createProviderHttpError,
  readProviderJsonResponse,
  readProviderTextResponse,
  resolveProviderRequestHeaders,
} from "carapace/plugin-sdk/provider-http";
import {
  captureWsEvent,
  createDebugProxyWebSocketAgent,
  resolveDebugProxySettings,
} from "carapace/plugin-sdk/proxy-capture";
import { createRealtimeTranscriptionWebSocketSession } from "carapace/plugin-sdk/realtime-transcription-session";
import { warn } from "carapace/plugin-sdk/runtime-env";
import { redactSensitiveText } from "carapace/plugin-sdk/security-runtime";
import { fetchWithSsrFGuard } from "carapace/plugin-sdk/ssrf-runtime";

export const openAIRealtimeHost = {
  resolveAgentDir,
  isProviderAuthProfileConfigured,
  resolveProviderAuthProfileApiKey,
  resolveProviderRequestHeaders,
  createRealtimeTranscriptionWebSocketSession,
  captureWsEvent,
  createDebugProxyWebSocketAgent,
  resolveDebugProxySettings,
  fetchWithSsrFGuard,
  createProviderHttpError,
  readProviderJsonResponse,
  readProviderTextResponse,
  formatErrorMessage,
  warn,
  redactSensitiveText,
} satisfies Omit<
  PluginCapabilityCatalogContext,
  "isProviderApiKeyConfigured" | "resolveApiKeyForProvider"
>;

export type OpenAIRealtimeHost = typeof openAIRealtimeHost;

// Chat-completions providers (M7): implementations live under llm/providers/ and
// share the ChatProvider port from agent.ts. This module re-exports them so older
// import paths (src/core/llm.js) keep working.

export {
  OpenAiProvider as OpenAiCompatibleProvider,
  type OpenAiProviderOptions as OpenAiCompatibleOptions,
} from "./llm/providers/openai.js";
export { AnthropicProvider, type AnthropicProviderOptions } from "./llm/providers/anthropic.js";
export { OllamaLocalProvider, type OllamaLocalProviderOptions } from "./llm/providers/ollama.js";
export { FallbackProvider, type ProviderLog } from "./llm/providers/fallback.js";
export { probeProviderEndpoint, type ProviderProbeResult } from "./llm/providers/probe.js";
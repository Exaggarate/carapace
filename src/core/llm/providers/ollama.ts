// Ollama local provider (M7): Ollama ships an OpenAI-compatible /v1 server, so this
// is the OpenAI provider with local defaults. Ollama ignores the bearer token — a
// placeholder keeps the base class header-correct without requiring configuration.

import { OpenAiProvider } from "./openai.js";

export interface OllamaLocalProviderOptions {
  /** Default http://127.0.0.1:11434/v1. */
  baseURL?: string;
  /** Optional — ignored by Ollama, sent anyway for header correctness. */
  apiKey?: string;
  model: string;
  timeoutMs: number;
}

export class OllamaLocalProvider extends OpenAiProvider {
  override readonly name = "ollama";

  constructor(options: OllamaLocalProviderOptions) {
    super({
      baseURL: options.baseURL ?? "http://127.0.0.1:11434/v1",
      apiKey: options.apiKey ?? "ollama",
      model: options.model,
      timeoutMs: options.timeoutMs,
    });
  }
}
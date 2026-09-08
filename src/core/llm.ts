// OpenAI-compatible chat-completions provider — plain fetch, non-streaming (M1).
// Any endpoint speaking POST {baseURL}/chat/completions works: OpenAI, Ollama (/v1),
// vLLM, LM Studio, OpenRouter. One automatic retry on 429/5xx/network errors.

import {
  LlmError,
  type ChatMessage,
  type ChatProvider,
  type CompletionRequest,
  type CompletionResult,
  type CompletionStopReason,
  type ToolCallRequest,
} from "./agent.js";

export interface OpenAiCompatibleOptions {
  baseURL: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}

const RETRY_DELAY_MS = 1_000;
const ERROR_BODY_CAP_CHARS = 400;

interface WireToolCall {
  id?: unknown;
  type?: unknown;
  function?: { name?: unknown; arguments?: unknown };
}

interface WireChoice {
  message?: { role?: unknown; content?: unknown; tool_calls?: unknown };
  finish_reason?: unknown;
}

interface WireResponse {
  choices?: unknown;
}

export class OpenAiCompatibleProvider implements ChatProvider {
  readonly name = "openai-compatible";

  constructor(private readonly options: OpenAiCompatibleOptions) {}

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const url = `${this.options.baseURL.replace(/\/+$/, "")}/chat/completions`;
    const payload = JSON.stringify({
      model: this.options.model,
      messages: request.messages.map(toWireMessage),
      ...(request.tools.length > 0 ? { tools: request.tools } : {}),
    });

    const raw = (await this.postWithRetry(url, payload)) as WireResponse;
    const choices = Array.isArray(raw.choices) ? (raw.choices as WireChoice[]) : [];
    const choice = choices[0];
    if (choice === undefined || choice.message === undefined) {
      throw new LlmError(`chat/completions response contained no message: ${capError(JSON.stringify(raw))}`);
    }

    const wireCalls = Array.isArray(choice.message.tool_calls)
      ? (choice.message.tool_calls as WireToolCall[])
      : [];
    const toolCalls = wireCalls.map(toToolCallRequest);
    const text = typeof choice.message.content === "string" ? choice.message.content : "";
    const stopReason: CompletionStopReason = toolCalls.length > 0 ? "tool_use" : "final_answer";
    return { text, toolCalls, stopReason };
  }

  /** POST JSON; retries once on 429/5xx/network errors, never on 4xx protocol errors. */
  private async postWithRetry(url: string, payload: string): Promise<unknown> {
    let lastError = "unknown error";
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${this.options.apiKey}`,
          },
          body: payload,
          signal: AbortSignal.timeout(this.options.timeoutMs),
        });
        const body = await response.text();
        if (response.ok) {
          try {
            return JSON.parse(body) as unknown;
          } catch {
            throw new LlmError(`chat/completions returned 200 with a non-JSON body: ${capError(body)}`);
          }
        }
        lastError = `HTTP ${response.status} ${response.statusText}: ${capError(body)}`;
        const retryable = response.status === 429 || response.status >= 500;
        if (!retryable) throw new LlmError(lastError);
      } catch (error) {
        if (error instanceof LlmError) throw error;
        lastError = `network error: ${(error as Error).message}`;
      }
      if (attempt === 1) await sleep(RETRY_DELAY_MS);
    }
    throw new LlmError(`chat/completions failed after 2 attempts — last error: ${lastError}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(() => resolve(), ms));
}

function capError(text: string): string {
  if (text.length <= ERROR_BODY_CAP_CHARS) return text;
  return `${text.slice(0, ERROR_BODY_CAP_CHARS)}…`;
}

function toWireMessage(message: ChatMessage): WireMessageType {
  if (message.role === "assistant" && message.toolCalls !== undefined && message.toolCalls.length > 0) {
    return {
      role: "assistant",
      content: message.content === "" ? null : message.content,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: {
          name: call.name,
          arguments: call.argumentsRaw ?? JSON.stringify(call.arguments),
        },
      })),
    };
  }
  if (message.role === "tool") {
    return { role: "tool", content: message.content, tool_call_id: message.toolCallId ?? "" };
  }
  return { role: message.role, content: message.content };
}

interface WireMessageType {
  role: string;
  content: string | null;
  tool_calls?: unknown;
  tool_call_id?: string;
}

function toToolCallRequest(call: WireToolCall, index: number): ToolCallRequest {
  const name = typeof call.function?.name === "string" ? call.function.name : `unknown_tool_${index}`;
  const raw = typeof call.function?.arguments === "string" ? call.function.arguments : "{}";
  let parsed: Record<string, unknown> = {};
  let argumentsError: string | undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      parsed = value as Record<string, unknown>;
    } else {
      argumentsError = "arguments must be a JSON object";
    }
  } catch (error) {
    argumentsError = (error as Error).message;
  }
  const request: ToolCallRequest = {
    id: typeof call.id === "string" && call.id !== "" ? call.id : `call_${index}`,
    name,
    arguments: parsed,
    argumentsRaw: raw,
  };
  if (argumentsError !== undefined) request.argumentsError = argumentsError;
  return request;
}
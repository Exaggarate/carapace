// OpenAI-compatible chat-completions provider — plain fetch, non-streaming.
// Any endpoint speaking POST {baseURL}/chat/completions works: OpenAI, OpenRouter,
// vLLM, LM Studio, Ollama (/v1). One automatic retry on 429/5xx/network errors.

import {
  LlmError,
  type ChatMessage,
  type ChatProvider,
  type CompletionRequest,
  type CompletionResult,
  type CompletionStopReason,
  type ToolCallRequest,
} from "../../agent.js";
import { capErrorBody, postJsonWithRetry } from "./http.js";

export interface OpenAiProviderOptions {
  baseURL: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}

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

export class OpenAiProvider implements ChatProvider {
  // Widened to string so provider subclasses (OllamaLocalProvider) can re-label.
  readonly name: string = "openai";

  constructor(private readonly options: OpenAiProviderOptions) {}

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const url = `${this.options.baseURL.replace(/\/+$/, "")}/chat/completions`;
    const payload = JSON.stringify({
      model: this.options.model,
      messages: request.messages.map(toWireMessage),
      ...(request.tools.length > 0 ? { tools: request.tools } : {}),
    });

    const raw = (await postJsonWithRetry({
      url,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.options.apiKey}`,
      },
      payload,
      timeoutMs: this.options.timeoutMs,
      signal: request.signal,
      label: "chat/completions",
    })) as WireResponse;
    const choices = Array.isArray(raw.choices) ? (raw.choices as WireChoice[]) : [];
    const choice = choices[0];
    if (choice === undefined || choice.message === undefined) {
      throw new LlmError(`chat/completions response contained no message: ${capErrorBody(JSON.stringify(raw))}`);
    }

    const wireCalls = Array.isArray(choice.message.tool_calls)
      ? (choice.message.tool_calls as WireToolCall[])
      : [];
    const toolCalls = wireCalls.map(toToolCallRequest);
    const text = typeof choice.message.content === "string" ? choice.message.content : "";
    const stopReason: CompletionStopReason = toolCalls.length > 0 ? "tool_use" : "final_answer";
    return { text, toolCalls, stopReason };
  }
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
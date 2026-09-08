// Native Anthropic Messages API provider (M7): POST {baseURL}/v1/messages with
// x-api-key + anthropic-version headers. System prompts ride the `system` field,
// tool calls arrive as tool_use content blocks and results go back as tool_result
// blocks. Same retry policy as the OpenAI-compatible provider.

import {
  LlmError,
  type ChatMessage,
  type ChatProvider,
  type CompletionRequest,
  type CompletionResult,
  type ToolCallRequest,
} from "../../agent.js";
import type { ToolSpec } from "../../tools/registry.js";
import { capErrorBody, postJsonWithRetry } from "./http.js";

export interface AnthropicProviderOptions {
  apiKey: string;
  model: string;
  /** Default https://api.anthropic.com — the provider appends /v1/messages. */
  baseURL?: string;
  /** anthropic-version header value. */
  version?: string;
  /** Anthropic requires max_tokens on every request. */
  maxTokens?: number;
  timeoutMs: number;
}

const DEFAULT_VERSION = "2023-06-01";
const DEFAULT_MAX_TOKENS = 8_192;

interface AnthropicBlock {
  type?: unknown;
  text?: unknown;
  id?: unknown;
  name?: unknown;
  input?: unknown;
  tool_use_id?: unknown;
  content?: unknown;
}

interface AnthropicWireMessage {
  role: "user" | "assistant";
  content: AnthropicBlock[];
}

interface AnthropicWireResponse {
  type?: unknown;
  content?: unknown;
  error?: unknown;
}

export class AnthropicProvider implements ChatProvider {
  readonly name = "anthropic";

  constructor(private readonly options: AnthropicProviderOptions) {}

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const baseURL = (this.options.baseURL ?? "https://api.anthropic.com").replace(/\/+$/, "");
    const { system, messages } = toAnthropicMessages(request.messages);
    const payload = JSON.stringify({
      model: this.options.model,
      max_tokens: this.options.maxTokens ?? DEFAULT_MAX_TOKENS,
      ...(system !== "" ? { system } : {}),
      messages,
      ...(request.tools.length > 0 ? { tools: request.tools.map(toAnthropicTool) } : {}),
    });

    const raw = (await postJsonWithRetry({
      url: `${baseURL}/v1/messages`,
      headers: {
        "content-type": "application/json",
        "x-api-key": this.options.apiKey,
        "anthropic-version": this.options.version ?? DEFAULT_VERSION,
      },
      payload,
      timeoutMs: this.options.timeoutMs,
      signal: request.signal,
      label: "anthropic v1/messages",
    })) as AnthropicWireResponse;

    if (raw.type === "error" || (raw.error !== undefined && !Array.isArray(raw.content))) {
      throw new LlmError(`anthropic v1/messages returned an error object: ${capErrorBody(JSON.stringify(raw))}`);
    }
    const blocks = Array.isArray(raw.content) ? (raw.content as AnthropicBlock[]) : [];
    let text = "";
    const toolCalls: ToolCallRequest[] = [];
    for (const block of blocks) {
      if (typeof block !== "object" || block === null || typeof block.type !== "string") continue;
      if (block.type === "text" && typeof block.text === "string") {
        text = text === "" ? block.text : `${text}\n${block.text}`;
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: typeof block.id === "string" && block.id !== "" ? block.id : `call_${toolCalls.length}`,
          name: typeof block.name === "string" ? block.name : `unknown_tool_${toolCalls.length}`,
          arguments:
            typeof block.input === "object" && block.input !== null && !Array.isArray(block.input)
              ? (block.input as Record<string, unknown>)
              : {},
        });
      }
    }
    return { text, toolCalls, stopReason: toolCalls.length > 0 ? "tool_use" : "final_answer" };
  }
}

/** Carapace tool specs are OpenAI-function-shaped; Anthropic wants flat name/description/input_schema. */
function toAnthropicTool(spec: ToolSpec): { name: string; description: string; input_schema: ToolSpec["function"]["parameters"] } {
  return {
    name: spec.function.name,
    description: spec.function.description,
    input_schema: spec.function.parameters,
  };
}

/**
 * Map Carapace history onto Anthropic's shape: system messages collapse into the
 * `system` string; consecutive same-role messages merge (Anthropic expects strict
 * user/assistant alternation, and grouped tool results become one user turn of
 * tool_result blocks).
 */
function toAnthropicMessages(messages: ChatMessage[]): { system: string; messages: AnthropicWireMessage[] } {
  let system = "";
  const out: AnthropicWireMessage[] = [];
  const push = (role: "user" | "assistant", blocks: AnthropicBlock[]): void => {
    const last = out[out.length - 1];
    if (last !== undefined && last.role === role) last.content.push(...blocks);
    else out.push({ role, content: blocks });
  };
  for (const message of messages) {
    if (message.role === "system") {
      system = system === "" ? message.content : `${system}\n${message.content}`;
      continue;
    }
    if (message.role === "user") {
      push("user", [{ type: "text", text: message.content }]);
      continue;
    }
    if (message.role === "assistant") {
      const blocks: AnthropicBlock[] = [];
      if (message.content !== "") blocks.push({ type: "text", text: message.content });
      for (const call of message.toolCalls ?? []) {
        blocks.push({ type: "tool_use", id: call.id, name: call.name, input: call.arguments });
      }
      if (blocks.length > 0) push("assistant", blocks);
      continue;
    }
    // Tool result → user turn with a tool_result block (merged when consecutive).
    push("user", [{ type: "tool_result", tool_use_id: message.toolCallId ?? "", content: message.content }]);
  }
  return { system, messages: out };
}
// The agent loop: assemble context → call the LLM → run requested tools → feed
// results back → iterate until a final answer, the tool-iteration cap, or an error.
// Context comes from the SessionStore; tools execute through the ToolRegistry.

import { carapaceHome, type CarapaceConfig } from "../config.js";
import type { SessionStore } from "./session.js";
import type { ToolContext, ToolRegistry, ToolResult, ToolSpec } from "./tools/registry.js";

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** Present on role="tool" messages: ties the result to its tool call. */
  toolCallId?: string;
  /** Present on role="tool" messages: which tool produced this. */
  toolName?: string;
  /** Present on role="assistant" messages: tool calls requested alongside the text. */
  toolCalls?: ToolCallRequest[];
}

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  /** Raw arguments string as the provider supplied it (kept for error reporting). */
  argumentsRaw?: string;
  /** Set when arguments were not valid JSON; the call is reported back, not run. */
  argumentsError?: string;
}

export interface CompletionRequest {
  messages: ChatMessage[];
  /** OpenAI-compatible tool specs offered to the model for this turn. */
  tools: ToolSpec[];
}

export type CompletionStopReason = "final_answer" | "tool_use";

export interface CompletionResult {
  text: string;
  toolCalls: ToolCallRequest[];
  stopReason: CompletionStopReason;
}

/** Raised by providers on transport/protocol failures; the loop turns it into a reply. */
export class LlmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmError";
  }
}

/**
 * Provider-agnostic chat completion port. M1 ships the OpenAI-compatible
 * implementation (src/core/llm.ts); more follow.
 */
export interface ChatProvider {
  readonly name: string;
  complete(request: CompletionRequest): Promise<CompletionResult>;
}

export interface AgentRuntime {
  config: CarapaceConfig;
  provider: ChatProvider;
  tools: ToolRegistry;
  sessions: SessionStore;
}

export interface AgentTurnInput {
  sessionId: string;
  text: string;
  /** Origin channel for fresh sessions (defaults to "unknown"). */
  channel?: string;
}

export type AgentTurnStopReason = "final_answer" | "max_iterations" | "error";

export interface AgentTurnResult {
  sessionId: string;
  reply: string;
  iterations: number;
  toolCallsExecuted: number;
  stopReason: AgentTurnStopReason;
}

const TOOL_RESULT_CAP_CHARS = 20_000;
const TOOL_TIMEOUT_MS = 120_000;

function truncate(text: string, capChars: number): string {
  return text.length <= capChars
    ? text
    : `${text.slice(0, capChars)}\n[truncated — ${text.length} chars total]`;
}

/**
 * Run one tool call with full defensive handling: unknown tools, malformed arguments,
 * missing required fields, thrown errors, and timeouts all become tool results the
 * model can read and recover from.
 */
export async function executeToolCall(
  tools: ToolRegistry,
  call: ToolCallRequest,
  context: ToolContext,
): Promise<ToolResult> {
  const tool = tools.get(call.name);
  if (tool === undefined) {
    return {
      ok: false,
      output: `unknown tool "${call.name}" — available tools: ${tools.names().join(", ")}`,
    };
  }
  if (call.argumentsError !== undefined) {
    return {
      ok: false,
      output:
        `tool "${call.name}" received arguments that were not valid JSON (${call.argumentsError}); ` +
        "call it again with a well-formed JSON object",
    };
  }
  const missing = tool.inputSchema.required.filter((key) => {
    const value = call.arguments[key];
    return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
  });
  if (missing.length > 0) {
    return { ok: false, output: `tool "${call.name}" is missing required argument(s): ${missing.join(", ")}` };
  }

  let timer: unknown;
  try {
    const result = await Promise.race([
      tool.execute(call.arguments, context),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`tool "${call.name}" timed out after ${TOOL_TIMEOUT_MS}ms`)),
          TOOL_TIMEOUT_MS,
        );
      }),
    ]);
    return { ok: result.ok, output: truncate(result.output, TOOL_RESULT_CAP_CHARS) };
  } catch (error) {
    return { ok: false, output: `tool "${call.name}" failed: ${(error as Error).message}` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run one agent turn:
 *   1. persist the user message
 *   2. assemble system prompt + history, call the provider with the registered tools
 *   3. tool calls → execute each, append results, loop (bounded by maxToolIterations)
 *   4. no tool calls → persist the final assistant message and return it
 * Provider failures end the turn with stopReason "error"; the cap ends it with
 * "max_iterations" and the best partial answer available.
 */
export async function runAgentTurn(input: AgentTurnInput, runtime: AgentRuntime): Promise<AgentTurnResult> {
  const sessionId = input.sessionId;
  const { sessions, config, provider, tools } = runtime;
  const maxIterations = config.agent.maxToolIterations;

  sessions.getOrCreate(sessionId, input.channel ?? "unknown");
  sessions.appendUser(sessionId, input.text);

  const workdir = config.tools.allowedRoots[0] ?? carapaceHome();
  let toolCallsExecuted = 0;
  let iterations = 0;
  let providerError: string | null = null;

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    iterations = iteration;

    let completion: CompletionResult;
    try {
      completion = await provider.complete({
        messages: sessions.buildContext(sessionId, config.agent.systemPrompt),
        tools: tools.toSpecs(),
      });
    } catch (error) {
      providerError = error instanceof LlmError ? error.message : `provider failed: ${(error as Error).message}`;
      break;
    }

    if (completion.toolCalls.length > 0) {
      sessions.appendAssistant(sessionId, completion.text, completion.toolCalls);
      const context: ToolContext = { sessionId, workdir };
      for (const call of completion.toolCalls) {
        const result = await executeToolCall(tools, call, context);
        toolCallsExecuted += 1;
        sessions.appendToolResult(sessionId, call.id, call.name, result.output);
      }
      continue;
    }

    const reply = completion.text.trim() === "" ? "(the model returned an empty response)" : completion.text;
    sessions.appendAssistant(sessionId, reply);
    return { sessionId, reply, iterations, toolCallsExecuted, stopReason: "final_answer" };
  }

  if (providerError !== null) {
    const reply = `agent turn failed: ${providerError}`;
    sessions.appendAssistant(sessionId, reply);
    return { sessionId, reply, iterations, toolCallsExecuted, stopReason: "error" };
  }

  const partial = [...sessions.history(sessionId)]
    .reverse()
    .find((message) => message.role === "assistant" && message.content.trim() !== "")?.content;
  const reply =
    partial ?? `reached the tool-iteration limit (${maxIterations}) without a final answer — try a narrower request`;
  if (partial === undefined) {
    sessions.appendAssistant(sessionId, reply);
  }
  return { sessionId, reply, iterations, toolCallsExecuted, stopReason: "max_iterations" };
}
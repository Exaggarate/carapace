// Agent loop — M0 skeleton.
// The real loop lands in M1: assemble context → call the model → run requested tools
// through the registry → feed results back → iterate until a final answer or the
// maxToolIterations cap. Channels and storage code against these types today so the
// M1 swap stays contained to this file plus one provider implementation.

import type { CarapaceConfig } from "../config.js";
import type { ToolRegistry } from "./tools/registry.js";

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** Present on role="tool" messages: ties the result to its tool call. */
  toolCallId?: string;
  /** Present on role="tool" messages: which tool produced this. */
  toolName?: string;
}

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface CompletionRequest {
  messages: ChatMessage[];
  /** Names of registered tools offered to the model for this turn. */
  tools: string[];
}

export type StopReason = "final_answer" | "tool_use" | "max_iterations" | "error";

export interface CompletionResult {
  text: string;
  toolCalls: ToolCallRequest[];
  stopReason: StopReason;
}

/**
 * Provider-agnostic chat completion port. M1 ships the first implementation
 * (OpenAI-compatible /chat/completions over fetch); more follow.
 */
export interface ChatProvider {
  readonly name: string;
  complete(request: CompletionRequest): Promise<CompletionResult>;
}

/** Stand-in used at M0 so wiring compiles before real providers exist. */
export class PlaceholderProvider implements ChatProvider {
  readonly name = "placeholder";

  async complete(_request: CompletionRequest): Promise<CompletionResult> {
    return { text: "", toolCalls: [], stopReason: "error" };
  }
}

export interface AgentRuntime {
  config: CarapaceConfig;
  provider: ChatProvider;
  tools: ToolRegistry;
}

export interface AgentTurnInput {
  sessionId: string;
  text: string;
}

export interface AgentTurnResult {
  sessionId: string;
  reply: string;
  iterations: number;
  toolCallsExecuted: number;
  stopReason: "final_answer" | "max_iterations" | "unavailable";
}

export const DEFAULT_MAX_TOOL_ITERATIONS = 8;

/**
 * Run one agent turn. M0 stub: reports honestly that the loop is not implemented
 * (stopReason "unavailable") so channels can already render a sane reply shape.
 *
 * M1 loop (documented contract):
 *   1. assemble system prompt + session history + the new user message
 *   2. call provider.complete() offering the registered tools
 *   3. stopReason "tool_use" → execute each requested tool via the registry,
 *      append role="tool" results, go back to 2 — bounded by maxToolIterations
 *   4. stopReason "final_answer" → persist messages, return the reply
 */
export async function runAgentTurn(
  input: AgentTurnInput,
  _runtime: AgentRuntime,
): Promise<AgentTurnResult> {
  return {
    sessionId: input.sessionId,
    reply: "carapace: the agent loop lands in M1 — this turn was not processed.",
    iterations: 0,
    toolCallsExecuted: 0,
    stopReason: "unavailable",
  };
}
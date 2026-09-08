// The agent loop: assemble context → call the LLM → run requested tools → feed
// results back → iterate until a final answer, the tool-iteration cap, or an error.
// Context comes from the SessionStore; tools execute through the ToolRegistry.

import { carapaceHome, type CarapaceConfig } from "../config.js";
import type { MemoryStore } from "./memory.js";
import type { SessionStore } from "./session.js";
import type { SkillRegistry } from "./skills.js";
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
  /**
   * Cancellation signal for the transport (turn budget / stall watchdog, #68596).
   * Providers that honor it cancel the in-flight request; the loop additionally
   * races the call against a timer so providers that ignore it are cut anyway.
   */
  signal?: AbortSignal;
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
  /** Installed skill playbooks (M7); their index is appended to the system prompt. */
  skills?: SkillRegistry;
  /** Plain-file memory (M9); its daily tail + long-term digest enter every system prompt. */
  memory?: MemoryStore;
}

export interface AgentTurnInput {
  sessionId: string;
  text: string;
  /** Origin channel for fresh sessions (defaults to "unknown"). */
  channel?: string;
  /** Sender id from the channel (per-sender routing, #81271). */
  senderId?: string;
  /** Per-turn tool registry override (per-sender allowlist, #81271). */
  tools?: ToolRegistry;
  /** Per-turn provider override (per-sender model override, #81271). */
  provider?: ChatProvider;
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
  /** Epoch-ms turn deadline (#68596): the tool cap shrinks to the remaining budget. */
  deadlineMs?: number,
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

  const stepCapMs =
    deadlineMs === undefined
      ? TOOL_TIMEOUT_MS
      : Math.min(TOOL_TIMEOUT_MS, Math.max(0, deadlineMs - Date.now()));
  if (stepCapMs <= 0) {
    return { ok: false, output: `turn budget exhausted — tool "${call.name}" was not run (llm.turnTimeoutMs)` };
  }

  let timer: unknown;
  try {
    const result = await Promise.race([
      tool.execute(call.arguments, context),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`tool "${call.name}" timed out after ${stepCapMs}ms`)),
          stepCapMs,
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

interface TurnLimits {
  watchdogMs: number;
  turnDeadline: number | null;
  watchdogText: string;
  budgetText: string;
}

/**
 * One provider call under the turn watchdog (#68596): the race rejects with a clean
 * LlmError when the model stalls past llm.watchdogTimeoutSec or the llm.turnTimeoutMs
 * budget runs out mid-call. The AbortController cancels real transports that honor
 * CompletionRequest.signal; the timer race also cuts providers that ignore it.
 */
async function completeWithWatchdog(
  provider: ChatProvider,
  request: CompletionRequest,
  limits: TurnLimits,
): Promise<CompletionResult> {
  const candidates = [limits.watchdogMs > 0 ? limits.watchdogMs : Infinity];
  if (limits.turnDeadline !== null) candidates.push(Math.max(0, limits.turnDeadline - Date.now()));
  const stallMs = Math.min(...candidates);
  if (!Number.isFinite(stallMs)) return provider.complete(request);

  const controller = new AbortController();
  let timer: unknown;
  try {
    return await Promise.race([
      provider.complete({ ...request, signal: controller.signal }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const error = new LlmError(watchdogAbortText(limits));
          controller.abort(error);
          reject(error);
        }, stallMs);
      }),
    ]);
  } catch (error) {
    // A transport that aborted on the signal surfaces a bare AbortError with no
    // user-facing context — map any abort back to the readable watchdog text.
    if (controller.signal.aborted) throw new LlmError(watchdogAbortText(limits));
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function watchdogAbortText(limits: TurnLimits): string {
  return limits.turnDeadline !== null && Date.now() >= limits.turnDeadline
    ? limits.budgetText
    : limits.watchdogText;
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
  const { sessions, config } = runtime;
  const provider = input.provider ?? runtime.provider;
  const tools = input.tools ?? runtime.tools;
  const maxIterations = config.agent.maxToolIterations;

  // Skills (M7): append the registry's "available skills" block to the system prompt
  // so the agent knows which playbooks exist and where each SKILL.md lives.
  // Memory (M9): today's daily-note tail + long-term digest join the same prompt.
  const skillsBlock = runtime.skills?.systemContextBlock() ?? null;
  const memoryBlock = runtime.memory?.contextBlock() ?? null;
  let systemPrompt = config.agent.systemPrompt;
  if (skillsBlock !== null) systemPrompt += `\n\n${skillsBlock}`;
  if (memoryBlock !== null) systemPrompt += `\n\n${memoryBlock}`;

  // Turn budget + stall watchdog (#68596): llm.turnTimeoutMs bounds the whole turn,
  // llm.watchdogTimeoutSec aborts a single provider call that never completes.
  // Hand-built configs (tests) may omit llm — absent values disable both limits.
  const turnTimeoutMs = config.llm?.turnTimeoutMs ?? 0;
  const watchdogTimeoutSec = config.llm?.watchdogTimeoutSec ?? 0;
  const turnDeadline = turnTimeoutMs > 0 ? Date.now() + turnTimeoutMs : null;
  const watchdogText =
    `the model stalled — no response within ${watchdogTimeoutSec}s, so the turn was aborted ` +
    "(llm.watchdogTimeoutSec); try again or raise the limit";
  const budgetText =
    `the turn exceeded its ${turnTimeoutMs}ms budget and was aborted (llm.turnTimeoutMs); ` +
    "narrow the request or raise the limit";
  const limits: TurnLimits = { watchdogMs: watchdogTimeoutSec * 1000, turnDeadline, watchdogText, budgetText };

  sessions.getOrCreate(sessionId, input.channel ?? "unknown");
  sessions.appendUser(sessionId, input.text);

  const workdir = config.tools.allowedRoots[0] ?? carapaceHome();
  let toolCallsExecuted = 0;
  let iterations = 0;
  let providerError: string | null = null;

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    iterations = iteration;

    // Budget check between steps: once the deadline has passed, stop cleanly.
    if (turnDeadline !== null && Date.now() >= turnDeadline) {
      providerError = budgetText;
      break;
    }

    let completion: CompletionResult;
    try {
      completion = await completeWithWatchdog(
        provider,
        {
          messages: sessions.buildContext(sessionId, systemPrompt),
          tools: tools.toSpecs(),
        },
        limits,
      );
    } catch (error) {
      providerError = error instanceof LlmError ? error.message : `provider failed: ${(error as Error).message}`;
      break;
    }

    if (completion.toolCalls.length > 0) {
      sessions.appendAssistant(sessionId, completion.text, completion.toolCalls);
      const context: ToolContext = { sessionId, workdir, memoryWorkspace: runtime.memory?.workspaceDir };
      for (const call of completion.toolCalls) {
        const result = await executeToolCall(tools, call, context, turnDeadline ?? undefined);
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
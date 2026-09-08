// spawn_subagent (#85030): lets the agent run a focused sub-task in a short-lived
// sub-agent turn with its own session id, INHERITING the parent turn's tool registry
// by default. Nesting is capped at depth 1 and the sub-turn is time-boxed by
// agent.subagentTimeoutSec (default 300s). The sub-agent's final answer returns to
// the parent as this tool's result; its transcript stays inspectable in its own
// session instead of polluting the parent conversation.

import { randomUUID } from "node:crypto";
import { runAgentTurn, type AgentRuntime } from "../../agent.js";
import type { ToolDefinition } from "../registry.js";

const DEFAULT_SUBAGENT_TIMEOUT_SEC = 300;
const MIN_SUBAGENT_TIMEOUT_SEC = 5;
const MAX_SUBAGENT_TIMEOUT_SEC = 3600;
/** Hard execution cap for one spawn call in the parent loop (tool-wrapper bound). */
const TOOL_CAP_MS = 600_000;
const RESULT_CAP_CHARS = 20_000;

/** Effective time box for a spawned sub-agent turn (agent.subagentTimeoutSec, 5–3600). */
export function subagentTimeoutSec(config: { agent?: { subagentTimeoutSec?: number } }): number {
  const raw = config.agent?.subagentTimeoutSec;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return DEFAULT_SUBAGENT_TIMEOUT_SEC;
  return Math.min(MAX_SUBAGENT_TIMEOUT_SEC, Math.max(MIN_SUBAGENT_TIMEOUT_SEC, Math.round(raw)));
}

export function createSpawnSubagentTool(): ToolDefinition {
  return {
    name: "spawn_subagent",
    timeoutMs: TOOL_CAP_MS,
    description:
      "Run a focused sub-task in a short-lived sub-agent turn that inherits your tools and returns its final " +
      "answer as this tool's result. One nesting level, own session, time-boxed. Use it for self-contained " +
      "chunks of work that benefit from a clean context; pass complete instructions (it does not see this conversation).",
    inputSchema: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "Complete, self-contained instructions for the sub-agent.",
        },
      },
      required: ["task"],
    },
    async execute(input, context) {
      const handle = context.subagent;
      if (handle === undefined) {
        return { ok: false, output: "spawn_subagent is unavailable in this context (no agent runtime attached)" };
      }
      if (handle.depth >= 1) {
        return {
          ok: false,
          output: "spawn_subagent refused — sub-agents cannot nest (max depth 1); run the work directly instead",
        };
      }
      const task = typeof input.task === "string" ? input.task.trim() : "";
      if (task === "") {
        return { ok: false, output: 'spawn_subagent requires a non-empty "task"' };
      }
      const capMs = subagentTimeoutSec(handle.config) * 1000;
      const sessionId = `${context.sessionId}#subagent-${randomUUID().slice(0, 8)}`;
      const runtime: AgentRuntime = {
        config: handle.config,
        provider: handle.provider,
        tools: handle.tools,
        sessions: handle.sessions,
        skills: handle.skills,
        memory: handle.memory,
      };
      try {
        const result = await runAgentTurn(
          {
            sessionId,
            text: task,
            channel: "subagent",
            depth: 1,
            turnTimeoutMs: capMs,
            tools: handle.tools,
            provider: handle.provider,
          },
          runtime,
        );
        const ok = result.stopReason === "final_answer";
        return {
          ok,
          output: `${result.reply.slice(0, RESULT_CAP_CHARS)}\n[sub-agent ${sessionId} — ${result.stopReason}]`,
        };
      } catch (error) {
        return { ok: false, output: `spawn_subagent failed: ${(error as Error).message}` };
      }
    },
  };
}
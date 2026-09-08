// Tool registry — the toolbox the agent loop draws from.
// Tools expose name/description/JSON-schema params plus an execute() the loop calls;
// toSpecs() renders them for OpenAI-compatible function calling.

import type { CarapaceConfig } from "../../config.js";
import type { ChatProvider } from "../agent.js";
import type { MemoryStore } from "../memory.js";
import type { SessionStore } from "../session.js";
import type { SkillRegistry } from "../skills.js";

export interface ToolParameterSchema {
  type: "string" | "number" | "boolean";
  description?: string;
}

export interface ToolInputSchema {
  type: "object";
  properties: Record<string, ToolParameterSchema>;
  required: string[];
}

/** Handle for spawning sub-agent turns (#85030): the running turn's live runtime. */
export interface SubagentHandle {
  provider: ChatProvider;
  tools: ToolRegistry;
  sessions: SessionStore;
  config: CarapaceConfig;
  skills?: SkillRegistry;
  memory?: MemoryStore;
  /** Nesting depth of the CURRENT turn: 0 = top-level agent turn, 1 = spawned sub-turn. */
  depth: number;
}

export interface ToolContext {
  sessionId: string;
  workdir: string;
  /** Workspace root holding memory/ + MEMORY.md (memory tools, M9); absent = disabled. */
  memoryWorkspace?: string;
  /** Present inside an agent loop — spawn_subagent inherits the turn's runtime (#85030). */
  subagent?: SubagentHandle;
}

export interface ToolResult {
  ok: boolean;
  /** Text handed back to the model (and surfaced to channel logs). */
  output: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  /**
   * Optional per-tool execution cap in ms — the loop's default tool timeout otherwise
   * applies. Long-running wrappers (spawn_subagent, #85030) raise it; the turn's own
   * deadline always shrinks the effective cap.
   */
  timeoutMs?: number;
  execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
}

/** OpenAI-compatible wire shape for one tool offered to the model. */
export interface ToolSpec {
  type: "function";
  function: { name: string; description: string; parameters: ToolInputSchema };
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): this {
    if (this.tools.has(tool.name)) {
      throw new Error(`tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
    return this;
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  names(): string[] {
    return [...this.tools.keys()].sort();
  }

  /** Wire-ready tool specs in stable (alphabetical) order. */
  toSpecs(): ToolSpec[] {
    return this.names().map((name) => {
      const tool = this.tools.get(name);
      if (tool === undefined) throw new Error(`registry inconsistency: missing tool ${name}`);
      return {
        type: "function",
        function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
      };
    });
  }

  get size(): number {
    return this.tools.size;
  }

  /** Subset view (#81271): a new registry holding only the named tools. */
  filter(allow: string[]): ToolRegistry {
    const wanted = new Set(allow);
    const view = new ToolRegistry();
    for (const name of this.names()) {
      if (!wanted.has(name)) continue;
      const tool = this.tools.get(name);
      if (tool !== undefined) view.register(tool);
    }
    return view;
  }
}

export function createToolRegistry(): ToolRegistry {
  return new ToolRegistry();
}
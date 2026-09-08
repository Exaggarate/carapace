// Tool registry — the toolbox the agent loop draws from.
// M0: types plus an empty registry. Built-in tools (exec, files, web) land in M1.

export interface ToolParameterSchema {
  type: "string" | "number" | "boolean";
  description?: string;
}

export interface ToolInputSchema {
  type: "object";
  properties: Record<string, ToolParameterSchema>;
  required: string[];
}

export interface ToolContext {
  sessionId: string;
  workdir: string;
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
  execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
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

  names(): string[] {
    return [...this.tools.keys()].sort();
  }

  get size(): number {
    return this.tools.size;
  }
}

export function createToolRegistry(): ToolRegistry {
  return new ToolRegistry();
}
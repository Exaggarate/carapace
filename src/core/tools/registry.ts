// Tool registry — the toolbox the agent loop draws from.
// Tools expose name/description/JSON-schema params plus an execute() the loop calls;
// toSpecs() renders them for OpenAI-compatible function calling.

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
}

export function createToolRegistry(): ToolRegistry {
  return new ToolRegistry();
}
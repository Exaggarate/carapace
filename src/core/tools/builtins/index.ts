// Built-in tool pack: exec, files, web_fetch — registered in one place so the agent
// loop, the CLI, and tests agree on what the model can call. On top of the built-ins,
// operator-defined tools from ~/.carapace/tools (*.json, #80213) are registered, and
// their optional setup hooks run once on first load with their output logged.

import { carapaceHome, type CarapaceConfig } from "../../../config.js";
import { ToolRegistry } from "../registry.js";
import { fileToolsDir, fileToolDefinition, loadFileToolDefs, runSetupOnce } from "../custom.js";
import { createExecTool } from "./exec.js";
import { createFilesTool } from "./files.js";
import { createMemoryReadTool, createMemoryWriteTool } from "./memory.js";
import { createWebFetchTool } from "./web-fetch.js";

/**
 * Built-in tools only (exec, files, web_fetch). Pure — no side effects, no setups;
 * used by `carapace doctor` and as the base for the full toolbox.
 */
export function createBuiltinToolRegistry(config: CarapaceConfig): ToolRegistry {
  const allowedRoots = config.tools.allowedRoots;
  const registry = new ToolRegistry();
  registry.register(
    createExecTool({
      timeoutMs: config.tools.exec.timeoutMs,
      denylist: config.tools.exec.denylist,
      cwd: allowedRoots[0] ?? carapaceHome(),
      allowedRoots,
    }),
  );
  registry.register(createFilesTool({ allowedRoots }));
  registry.register(createWebFetchTool());
  // Memory tools (M9): pure context consumers — they no-op safely when the
  // runtime has no memory workspace injected into ToolContext.
  registry.register(createMemoryReadTool());
  registry.register(createMemoryWriteTool());
  return registry;
}

/** Built-ins plus operator-defined tools from ~/.carapace/tools (setups run once). */
export function createBuiltinTools(config: CarapaceConfig): ToolRegistry {
  const registry = createBuiltinToolRegistry(config);
  registerFileTools(registry, config);
  return registry;
}

/**
 * Register file-defined tools and run their one-time setup hooks (#80213). A broken
 * definition file or a failed setup only logs a warning — it never blocks the rest
 * of the toolbox or gateway boot.
 */
export function registerFileTools(registry: ToolRegistry, config: CarapaceConfig): void {
  const dir = fileToolsDir();
  const { defs, issues } = loadFileToolDefs(dir);
  const log = (line: string): void => console.log(`[tools] ${line}`);
  for (const issue of issues) console.warn(`[tools] ${issue}`);
  const cwd = config.tools.allowedRoots[0] ?? carapaceHome();
  for (const def of defs) {
    if (registry.has(def.name)) {
      console.warn(`[tools] skipping "${def.name}" — that name is already registered`);
      continue;
    }
    registry.register(fileToolDefinition(def, { cwd, timeoutMs: config.tools.exec.timeoutMs }));
    runSetupOnce(dir, def, { cwd, timeoutMs: config.tools.exec.timeoutMs, log });
  }
}
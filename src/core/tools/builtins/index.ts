// Built-in tool pack: exec, files, web_fetch — registered in one place so the agent
// loop, the CLI, and tests agree on what the model can call.

import { carapaceHome, type CarapaceConfig } from "../../../config.js";
import { ToolRegistry } from "../registry.js";
import { createExecTool } from "./exec.js";
import { createFilesTool } from "./files.js";
import { createWebFetchTool } from "./web-fetch.js";

export function createBuiltinTools(config: CarapaceConfig): ToolRegistry {
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
  return registry;
}
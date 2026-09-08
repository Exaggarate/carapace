/**
 * Static identity for names that select core agent factory families before assembly.
 */

import { AUTOMATIONS_TOOL_NAME } from "./tools/automations-tool-name.js";

export type CoreToolFactoryFamily = "base-coding" | "shell" | "carapace";

type CoreToolFactoryDescriptor = {
  readonly name: string;
  readonly family: CoreToolFactoryFamily;
};

const CORE_TOOL_FACTORY_DESCRIPTORS = [
  { name: "edit", family: "base-coding" },
  { name: "read", family: "base-coding" },
  { name: "ls", family: "base-coding" },
  { name: "write", family: "base-coding" },
  { name: "apply_patch", family: "shell" },
  { name: "exec", family: "shell" },
  { name: "process", family: "shell" },
  { name: "agents_list", family: "carapace" },
  // Static factory identity only; runtime and tools.catalog apply the Swarm config gate.
  { name: "agents_wait", family: "carapace" },
  { name: "ask_user", family: "carapace" },
  { name: "carapace", family: "carapace" },
  { name: "computer", family: "carapace" },
  { name: "conversations_list", family: "carapace" },
  { name: "conversations_send", family: "carapace" },
  { name: "conversations_turn", family: "carapace" },
  { name: AUTOMATIONS_TOOL_NAME, family: "carapace" },
  { name: "screen", family: "carapace" },
  { name: "secrets", family: "carapace" },
  { name: "dashboard", family: "carapace" },
  { name: "gateway", family: "carapace" },
  { name: "get_goal", family: "carapace" },
  { name: "github_identity_status", family: "carapace" },
  { name: "github_publish", family: "carapace" },
  { name: "heartbeat_respond", family: "carapace" },
  { name: "view_image", family: "carapace" },
  { name: "image_generate", family: "carapace" },
  { name: "message", family: "carapace" },
  { name: "mobile_ui", family: "carapace" },
  { name: "music_generate", family: "carapace" },
  { name: "nodes", family: "carapace" },
  { name: "pdf", family: "carapace" },
  { name: "session_status", family: "carapace" },
  { name: "show_widget", family: "carapace" },
  { name: "progress_card", family: "carapace" },
  { name: "sessions", family: "carapace" },
  { name: "sessions_history", family: "carapace" },
  { name: "sessions_list", family: "carapace" },
  { name: "sessions_search", family: "carapace" },
  { name: "sessions_send", family: "carapace" },
  { name: "sessions_spawn", family: "carapace" },
  { name: "sessions_yield", family: "carapace" },
  { name: "structured_output", family: "carapace" },
  { name: "skill_workshop", family: "carapace" },
  { name: "suggest_task", family: "carapace" },
  { name: "create_goal", family: "carapace" },
  { name: "subagents", family: "carapace" },
  { name: "terminal", family: "carapace" },
  { name: "portal", family: "carapace" },
  { name: "transcripts", family: "carapace" },
  { name: "tts", family: "carapace" },
  { name: "update_goal", family: "carapace" },
  { name: "dismiss_task", family: "carapace" },
  { name: "video_generate", family: "carapace" },
  { name: "web_fetch", family: "carapace" },
  { name: "web_search", family: "carapace" },
] as const satisfies readonly CoreToolFactoryDescriptor[];

const CORE_TOOL_FACTORY_FAMILY_BY_NAME = new Map<string, CoreToolFactoryFamily>(
  CORE_TOOL_FACTORY_DESCRIPTORS.map(({ name, family }) => [name, family]),
);

export type CarapaceCodingToolConstructionPlan = {
  includeBaseCodingTools: boolean;
  includeShellTools: boolean;
  includeChannelTools: boolean;
  includeCarapaceTools: boolean;
  includePluginTools: boolean;
};

export function resolveCoreToolFactoryFamily(name: string): CoreToolFactoryFamily | undefined {
  return CORE_TOOL_FACTORY_FAMILY_BY_NAME.get(name);
}

export function listCoreToolFactoryDescriptors(): readonly CoreToolFactoryDescriptor[] {
  return CORE_TOOL_FACTORY_DESCRIPTORS;
}

/**
 * Core coding primitives (file + shell families). Tool-search compaction keeps
 * these directly visible: hiding them behind search adds a lookup round-trip to
 * nearly every coding turn.
 */
export function isCoreCodingSurfaceToolName(name: string): boolean {
  const family = CORE_TOOL_FACTORY_FAMILY_BY_NAME.get(name);
  return family === "base-coding" || family === "shell";
}

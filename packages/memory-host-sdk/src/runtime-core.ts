// Focused runtime contract for memory plugin config/state/helpers.

export type { AnyAgentTool } from "./host/carapace-runtime-agent.js";
export { resolveCronStyleNow } from "./host/carapace-runtime-agent.js";
export { DEFAULT_AGENT_COMPACTION_RESERVE_TOKENS_FLOOR } from "./host/carapace-runtime-agent.js";
export { resolveDefaultAgentId, resolveSessionAgentId } from "./host/carapace-runtime-agent.js";
export { resolveMemorySearchConfig } from "./host/carapace-runtime-agent.js";
export {
  asToolParamsRecord,
  jsonResult,
  readNumberParam,
  readStringParam,
} from "./host/carapace-runtime-agent.js";
export { SILENT_REPLY_TOKEN } from "./host/carapace-runtime-session.js";
export { parseNonNegativeByteSize } from "./host/carapace-runtime-config.js";
export {
  getRuntimeConfig,
  /** @deprecated Use getRuntimeConfig(), or pass the already loaded config through the call path. */
  loadConfig,
} from "./host/carapace-runtime-session.js";
export { resolveStateDir } from "./host/carapace-runtime-config.js";
export { resolveSessionTranscriptsDirForAgent } from "./host/carapace-runtime-config.js";
export { emptyPluginConfigSchema } from "./host/carapace-runtime-memory.js";
export {
  buildActiveMemoryPromptSection,
  getMemoryCapabilityRegistration,
  listActiveMemoryPublicArtifacts,
} from "./host/carapace-runtime-memory.js";
export { parseAgentSessionKey } from "./host/carapace-runtime-agent.js";
export type { CarapaceConfig } from "./host/carapace-runtime-config.js";
export type { MemoryCitationsMode } from "./host/carapace-runtime-config.js";
export type {
  MemoryFlushPlan,
  MemoryFlushPlanResolver,
  MemoryPluginCapability,
  MemoryPluginPublicArtifact,
  MemoryPluginPublicArtifactsProvider,
  MemoryPluginRuntime,
  MemoryPromptSectionBuilder,
} from "./host/carapace-runtime-memory.js";
export type { CarapacePluginApi } from "./host/carapace-runtime-memory.js";

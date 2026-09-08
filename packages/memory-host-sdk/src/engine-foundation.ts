// Real workspace contract for memory engine foundation concerns.

export {
  resolveAgentContextLimits,
  resolveAgentDir,
  resolveAgentWorkspaceDir,
  resolveDefaultAgentId,
  resolveSessionAgentId,
} from "./host/carapace-runtime-agent.js";
export {
  resolveMemorySearchConfig,
  resolveMemorySearchSyncConfig,
  type ResolvedMemorySearchConfig,
  type ResolvedMemorySearchSyncConfig,
} from "./host/carapace-runtime-agent.js";
export { parseDurationMs } from "./host/carapace-runtime-config.js";
export { loadConfig } from "./host/carapace-runtime-session.js";
export { resolveStateDir } from "./host/carapace-runtime-config.js";
export { resolveSessionTranscriptsDirForAgent } from "./host/carapace-runtime-config.js";
export {
  hasConfiguredSecretInput,
  normalizeResolvedSecretInputString,
} from "./host/carapace-runtime-config.js";
export { root } from "./host/carapace-runtime-io.js";
export { isPathInside } from "./host/fs-utils.js";
export { createSubsystemLogger } from "./host/carapace-runtime-io.js";
export { detectMime } from "./host/carapace-runtime-io.js";
export { resolveGlobalSingleton } from "./host/carapace-runtime-io.js";
export { onSessionTranscriptUpdate } from "./host/carapace-runtime-session.js";
export { splitShellArgs } from "./host/carapace-runtime-io.js";
export { runTasksWithConcurrency } from "./host/carapace-runtime-io.js";
export {
  shortenHomeInString,
  shortenHomePath,
  resolveUserPath,
  truncateUtf16Safe,
} from "./host/carapace-runtime-io.js";
export type { CarapaceConfig } from "./host/carapace-runtime-config.js";
export type { SecretInput } from "./host/carapace-runtime-config.js";
export type { MemoryCitationsMode } from "./host/carapace-runtime-config.js";
export type { MemorySearchConfig } from "./host/carapace-runtime-config.js";

// Memory Core plugin module implements cli.host behavior.
export {
  defaultRuntime,
  formatCliJsonFailure,
  formatErrorMessage,
  getMemoryEmbeddingCommandSecretTargetIds,
  resolveCommandSecretRefsViaGateway,
  setVerbose,
  shortenHomeInString,
  shortenHomePath,
  theme,
  withManager,
  withProgress,
  withProgressTotals,
} from "carapace/plugin-sdk/memory-core-host-runtime-cli";
export {
  getRuntimeConfig,
  resolveDefaultAgentId,
  type CarapaceConfig,
} from "carapace/plugin-sdk/memory-core-host-runtime-core";
export { getMemorySearchManager } from "./memory/index.js";

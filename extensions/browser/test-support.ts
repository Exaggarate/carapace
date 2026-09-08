/**
 * Browser test-support re-exports from shared plugin-sdk test fixtures.
 */
export {
  createCliRuntimeCapture,
  expectGeneratedTokenPersistedToGatewayAuth,
  type CliRuntimeCapture,
} from "carapace/plugin-sdk/test-fixtures";
export { createTempHomeEnv, useAutoCleanupTempDirTracker } from "carapace/plugin-sdk/test-env";
export { isLiveTestEnabled } from "carapace/plugin-sdk/test-live";
export type { CarapaceConfig } from "carapace/plugin-sdk/config-contracts";

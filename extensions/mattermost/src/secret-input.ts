// Mattermost plugin module implements secret input behavior.
export type { SecretInput } from "carapace/plugin-sdk/secret-input";
export {
  buildSecretInputSchema,
  hasConfiguredSecretInput,
  resolveSecretInputString,
} from "carapace/plugin-sdk/secret-input";
export type { SecretInputStringResolutionMode } from "carapace/plugin-sdk/secret-input";

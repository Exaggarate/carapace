// Defines external auth contracts for provider plugins.
import type { AuthProfileStore, OAuthCredential } from "../agents/auth-profiles/types.js";
import type { ModelProviderAuthMode, ModelProviderConfig } from "../config/types.js";
import type { CarapaceConfig } from "../config/types.carapace.js";
import type { SecretInputMode } from "./provider-auth-types.js";

export type ProviderAuthOptionBag = {
  token?: string;
  tokenProvider?: string;
  secretInputMode?: SecretInputMode;
  [key: string]: unknown;
};

/** Context for resolving synthetic provider credentials from config. */
export type ProviderResolveSyntheticAuthContext = {
  config?: CarapaceConfig;
  provider: string;
  providerConfig?: ModelProviderConfig;
};

/** Synthetic provider credential returned by plugin auth helpers. */
export type ProviderSyntheticAuthResult = {
  apiKey: string;
  source: string;
  mode: Exclude<ModelProviderAuthMode, "aws-sdk">;
  expiresAt?: number;
};

/** Context for resolving external provider auth profiles. */
export type ProviderResolveExternalAuthProfilesContext = {
  config?: CarapaceConfig;
  agentDir?: string;
  workspaceDir?: string;
  env: NodeJS.ProcessEnv;
  store: AuthProfileStore;
};

/** External auth profile credential resolved for a provider. */
export type ProviderExternalAuthProfile = {
  profileId: string;
  credential: OAuthCredential;
  persistence?: "runtime-only" | "persisted";
};

/** Internal synchronous resolver shared by provider hooks and auth-store overlays. */
export type ProviderExternalAuthProfileResolver = (params: {
  config?: CarapaceConfig;
  workspaceDir?: string;
  env?: NodeJS.ProcessEnv;
  context: ProviderResolveExternalAuthProfilesContext;
}) => ProviderExternalAuthProfile[];

// Defines web provider plugin schema and runtime types.
import type { TSchema } from "typebox";
import type { CarapaceConfig } from "../config/types.carapace.js";
import type { RuntimeEnv } from "../runtime.js";
import type {
  RuntimeWebFetchMetadata,
  RuntimeWebSearchMetadata,
} from "../secrets/runtime-web-tools.types.js";
import type { WizardPrompter } from "../wizard/prompts.js";
import type { SecretInputMode } from "./provider-auth-types.js";

type WebSearchProviderId = string;
type WebFetchProviderId = string;

export type WebSearchProviderToolDefinition = {
  description: string;
  parameters: TSchema;
  execute: (
    args: Record<string, unknown>,
    context?: WebSearchProviderToolExecutionContext,
  ) => Promise<Record<string, unknown>>;
};

export type WebFetchProviderToolDefinition = {
  description: string;
  parameters: TSchema;
  execute: (
    args: Record<string, unknown>,
    context?: { signal?: AbortSignal },
  ) => Promise<Record<string, unknown>>;
};

type WebSearchProviderContext = {
  config?: CarapaceConfig;
  searchConfig?: Record<string, unknown>;
  runtimeMetadata?: RuntimeWebSearchMetadata;
  agentDir?: string;
};

export type WebSearchProviderToolExecutionContext = {
  signal?: AbortSignal;
};

type WebFetchProviderContext = {
  config?: CarapaceConfig;
  fetchConfig?: Record<string, unknown>;
  runtimeMetadata?: RuntimeWebFetchMetadata;
};

export type WebSearchCredentialResolutionSource = "config" | "secretRef" | "env" | "missing";

type WebSearchProviderConfiguredCredentialFallback = {
  path: string;
  value: unknown;
};

type WebFetchProviderConfiguredCredentialFallback = {
  path: string;
  value: unknown;
};

type WebSearchRuntimeMetadataContext = {
  config?: CarapaceConfig;
  searchConfig?: Record<string, unknown>;
  runtimeMetadata?: RuntimeWebSearchMetadata;
  resolvedCredential?: {
    value?: string;
    source: WebSearchCredentialResolutionSource;
    fallbackEnvVar?: string;
  };
};

export type WebSearchProviderSetupContext = {
  config: CarapaceConfig;
  runtime: RuntimeEnv;
  prompter: WizardPrompter;
  quickstartDefaults?: boolean;
  secretInputMode?: SecretInputMode;
};

export type WebFetchCredentialResolutionSource = "config" | "secretRef" | "env" | "missing";

type WebFetchRuntimeMetadataContext = {
  config?: CarapaceConfig;
  fetchConfig?: Record<string, unknown>;
  runtimeMetadata?: RuntimeWebFetchMetadata;
  resolvedCredential?: {
    value?: string;
    source: WebFetchCredentialResolutionSource;
    fallbackEnvVar?: string;
  };
};

export type WebSearchProviderPlugin = {
  id: WebSearchProviderId;
  label: string;
  hint: string;
  onboardingScopes?: readonly "text-inference"[];
  requiresCredential?: boolean;
  credentialLabel?: string;
  envVars: string[];
  /** Optional model-provider auth profile id that can satisfy this web provider without a tool-specific API key. */
  authProviderId?: string;
  placeholder: string;
  signupUrl: string;
  docsUrl?: string;
  /** Optional note shown before credential collection for provider-specific prerequisites. */
  credentialNote?: string;
  autoDetectOrder?: number;
  credentialPath: string;
  inactiveSecretPaths?: string[];
  getCredentialValue: (searchConfig?: Record<string, unknown>) => unknown;
  setCredentialValue: (searchConfigTarget: Record<string, unknown>, value: unknown) => void;
  getConfiguredCredentialValue?: (config?: CarapaceConfig) => unknown;
  setConfiguredCredentialValue?: (configTarget: CarapaceConfig, value: unknown) => void;
  getConfiguredCredentialFallback?: (
    config?: CarapaceConfig,
  ) => WebSearchProviderConfiguredCredentialFallback | undefined;
  applySelectionConfig?: (config: CarapaceConfig) => CarapaceConfig;
  runSetup?: (ctx: WebSearchProviderSetupContext) => CarapaceConfig | Promise<CarapaceConfig>;
  resolveRuntimeMetadata?: (
    ctx: WebSearchRuntimeMetadataContext,
  ) => Partial<RuntimeWebSearchMetadata> | Promise<Partial<RuntimeWebSearchMetadata>>;
  createTool: (ctx: WebSearchProviderContext) => WebSearchProviderToolDefinition | null;
};

export type PluginWebSearchProviderEntry = WebSearchProviderPlugin & {
  pluginId: string;
};

export type WebFetchProviderPlugin = {
  id: WebFetchProviderId;
  label: string;
  hint: string;
  requiresCredential?: boolean;
  credentialLabel?: string;
  envVars: string[];
  placeholder: string;
  signupUrl: string;
  docsUrl?: string;
  autoDetectOrder?: number;
  credentialPath: string;
  inactiveSecretPaths?: string[];
  getCredentialValue: (fetchConfig?: Record<string, unknown>) => unknown;
  setCredentialValue: (fetchConfigTarget: Record<string, unknown>, value: unknown) => void;
  getConfiguredCredentialValue?: (config?: CarapaceConfig) => unknown;
  setConfiguredCredentialValue?: (configTarget: CarapaceConfig, value: unknown) => void;
  getConfiguredCredentialFallback?: (
    config?: CarapaceConfig,
  ) => WebFetchProviderConfiguredCredentialFallback | undefined;
  applySelectionConfig?: (config: CarapaceConfig) => CarapaceConfig;
  resolveRuntimeMetadata?: (
    ctx: WebFetchRuntimeMetadataContext,
  ) => Partial<RuntimeWebFetchMetadata> | Promise<Partial<RuntimeWebFetchMetadata>>;
  createTool: (ctx: WebFetchProviderContext) => WebFetchProviderToolDefinition | null;
};

export type PluginWebFetchProviderEntry = WebFetchProviderPlugin & {
  pluginId: string;
};

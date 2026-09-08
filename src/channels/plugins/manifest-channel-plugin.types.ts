import type { CarapaceConfig } from "../../config/types.carapace.js";
import type { ChannelConfigSchema } from "./types.config.js";

type ManifestChannelAccount = {
  accountId: string;
  name?: string;
  config: Record<string, unknown>;
};

/** Metadata adapters expose account inspection without loading channel runtime contracts. */
export type ManifestChannelPlugin = {
  id: string;
  meta: {
    id: string;
    label: string;
    selectionLabel: string;
    docsPath: string;
    blurb: string;
    preferOver?: readonly string[];
  };
  capabilities: { chatTypes: ["direct"] };
  commands?: {
    nativeCommandsAutoEnabled?: boolean;
    nativeSkillsAutoEnabled?: boolean;
  };
  configSchema?: ChannelConfigSchema;
  config: {
    listAccountIds: (cfg: CarapaceConfig) => string[];
    defaultAccountId: (cfg: CarapaceConfig) => string;
    resolveAccount: (cfg: CarapaceConfig, accountId?: string | null) => ManifestChannelAccount;
    isEnabled: (account: ManifestChannelAccount, cfg: CarapaceConfig) => boolean;
    isConfigured: (account: ManifestChannelAccount, cfg: CarapaceConfig) => boolean;
    hasConfiguredState: (params: { cfg: CarapaceConfig; env?: NodeJS.ProcessEnv }) => boolean;
  };
};

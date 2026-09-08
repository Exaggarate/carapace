import type {
  ChannelDoctorConfigMutation,
  ChannelDoctorLegacyConfigRule,
} from "carapace/plugin-sdk/channel-contract";
import type { CarapaceConfig } from "carapace/plugin-sdk/config-contracts";
import { defineChannelAliasMigration } from "carapace/plugin-sdk/runtime-doctor-migrations";

const streamingAliasMigration = defineChannelAliasMigration({
  channelId: "msteams",
  // Teams previews default to partial streaming, matching the runtime default
  // in reply-dispatcher when no mode is configured.
  streaming: { defaultMode: "partial" },
});

export const legacyConfigRules: ChannelDoctorLegacyConfigRule[] =
  streamingAliasMigration.legacyConfigRules;

export function normalizeCompatibilityConfig({
  cfg,
}: {
  cfg: CarapaceConfig;
}): ChannelDoctorConfigMutation {
  return streamingAliasMigration.normalizeChannelConfig({ cfg });
}

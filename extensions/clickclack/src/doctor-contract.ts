import type { ChannelDoctorConfigMutation } from "carapace/plugin-sdk/channel-contract";
import type { CarapaceConfig } from "carapace/plugin-sdk/config-contracts";
import { asObjectRecord } from "carapace/plugin-sdk/runtime-doctor-migrations";

function stripTimeoutSeconds(value: unknown): { value: unknown; changed: boolean } {
  const record = asObjectRecord(value);
  if (!record) {
    return { value, changed: false };
  }
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(record)) {
    if (key === "timeoutSeconds") {
      changed = true;
      continue;
    }
    const stripped = stripTimeoutSeconds(child);
    changed = changed || stripped.changed;
    next[key] = stripped.value;
  }
  return { value: changed ? next : value, changed };
}

export function normalizeCompatibilityConfig({
  cfg,
}: {
  cfg: CarapaceConfig;
}): ChannelDoctorConfigMutation {
  const rawEntry = asObjectRecord(
    (cfg.channels as Record<string, unknown> | undefined)?.clickclack,
  );
  if (!rawEntry) {
    return { config: cfg, changes: [] };
  }
  const stripped = stripTimeoutSeconds(rawEntry);
  if (!stripped.changed) {
    return { config: cfg, changes: [] };
  }
  return {
    config: {
      ...cfg,
      channels: {
        ...cfg.channels,
        clickclack: stripped.value,
      } as CarapaceConfig["channels"],
    },
    changes: ["Removed retired ClickClack timeout tuning knobs."],
  };
}

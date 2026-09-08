import crypto from "node:crypto";
import { stableStringify } from "@carapace/normalization-core";
import { redactConfigObject } from "../../config/redact-snapshot.js";
import type { CarapaceConfig } from "../../config/types.carapace.js";

let configFingerprints = new WeakMap<CarapaceConfig, string>();

export function fingerprintSkillSnapshotConfig(config: CarapaceConfig): string {
  const cached = configFingerprints.get(config);
  if (cached) {
    return cached;
  }
  const fingerprint = crypto
    .createHash("sha256")
    .update(stableStringify(redactConfigObject(config)))
    .digest("hex");
  configFingerprints.set(config, fingerprint);
  return fingerprint;
}

export function resetSkillSnapshotConfigFingerprintCache(): void {
  configFingerprints = new WeakMap();
}

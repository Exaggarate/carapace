import type {
  ConfigFileSnapshot,
  ConfigValidationIssue,
  LegacyConfigIssue,
  CarapaceConfig,
} from "../config/types.js";

export function createDoctorConfigSnapshot(
  params: {
    config?: Record<string, unknown>;
    parsed?: Record<string, unknown>;
    valid?: boolean;
    issues?: ConfigValidationIssue[];
    legacyIssues?: LegacyConfigIssue[];
  } = {},
): ConfigFileSnapshot {
  const config = (params.config ?? {}) as CarapaceConfig;
  return {
    path: "/tmp/carapace.json",
    includedPaths: [],
    exists: true,
    raw: "{}",
    parsed: params.parsed ?? {},
    sourceConfig: config,
    resolved: config,
    valid: params.valid ?? true,
    runtimeConfig: config,
    config,
    issues: params.issues ?? [],
    warnings: [],
    legacyIssues: params.legacyIssues ?? [],
  };
}

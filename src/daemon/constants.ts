/** Cross-platform daemon service names, labels, and profile-aware descriptions. */
import { normalizeLowercaseStringOrEmpty } from "@carapace/normalization-core/string-coerce";

// Default service labels (canonical + legacy compatibility)
export const GATEWAY_LAUNCH_AGENT_LABEL = "ai.carapace.gateway";
const GATEWAY_SYSTEMD_SERVICE_NAME = "carapace-gateway";
const GATEWAY_WINDOWS_TASK_NAME = "Carapace Gateway";
export const GATEWAY_SERVICE_MARKER = "carapace";
export const GATEWAY_SERVICE_KIND = "gateway";
export const GATEWAY_SERVICE_RUNTIME_PID_ENV = "CARAPACE_GATEWAY_SERVICE_PID";
export const GATEWAY_SERVICE_SELECTOR_ENV_KEYS = [
  "CARAPACE_STATE_DIR",
  "CARAPACE_CONFIG_PATH",
  "CARAPACE_PROFILE",
  "CARAPACE_GATEWAY_PORT",
  "CARAPACE_LAUNCHD_LABEL",
  "CARAPACE_SYSTEMD_UNIT",
  "CARAPACE_WINDOWS_TASK_NAME",
] as const;

export function isGatewayServiceEnv(env: Record<string, string | undefined>): boolean {
  if (env.CARAPACE_SERVICE_MARKER?.trim() !== GATEWAY_SERVICE_MARKER) {
    return false;
  }
  const serviceKind = env.CARAPACE_SERVICE_KIND?.trim();
  return !serviceKind || serviceKind === GATEWAY_SERVICE_KIND;
}

const NODE_LAUNCH_AGENT_LABEL = "ai.carapace.node";
const NODE_SYSTEMD_SERVICE_NAME = "carapace-node";
const NODE_WINDOWS_TASK_NAME = "Carapace Node";
const NODE_SERVICE_MARKER = "carapace";
export const NODE_SERVICE_KIND = "node";
const NODE_WINDOWS_TASK_SCRIPT_NAME = "node.cmd";
export const LEGACY_GATEWAY_SYSTEMD_SERVICE_NAMES: string[] = ["clawdbot-gateway"];

function normalizeGatewayProfile(profile?: string): string | null {
  const trimmed = profile?.trim();
  if (!trimmed || normalizeLowercaseStringOrEmpty(trimmed) === "default") {
    // The default profile keeps the historical unqualified service names.
    return null;
  }
  return trimmed;
}

export function resolveGatewayProfileSuffix(profile?: string): string {
  const normalized = normalizeGatewayProfile(profile);
  return normalized ? `-${normalized}` : "";
}

export function resolveGatewayLaunchAgentLabel(profile?: string): string {
  const normalized = normalizeGatewayProfile(profile);
  if (!normalized) {
    return GATEWAY_LAUNCH_AGENT_LABEL;
  }
  return `ai.carapace.${normalized}`;
}

export function resolveGatewaySystemdServiceName(profile?: string): string {
  const suffix = resolveGatewayProfileSuffix(profile);
  if (!suffix) {
    return GATEWAY_SYSTEMD_SERVICE_NAME;
  }
  return `carapace-gateway${suffix}`;
}

export function resolveGatewayWindowsTaskName(profile?: string): string {
  const normalized = normalizeGatewayProfile(profile);
  if (!normalized) {
    return GATEWAY_WINDOWS_TASK_NAME;
  }
  return `Carapace Gateway (${normalized})`;
}

type GatewayNativeServiceIdentityConflict = {
  envKey: "CARAPACE_LAUNCHD_LABEL" | "CARAPACE_SYSTEMD_UNIT" | "CARAPACE_WINDOWS_TASK_NAME";
  expected: string;
};

export function resolveGatewayNativeServiceIdentityConflict(
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform = process.platform,
): GatewayNativeServiceIdentityConflict | null {
  const profile = normalizeGatewayProfile(env.CARAPACE_PROFILE);
  if (!profile) {
    return null;
  }

  if (platform === "darwin") {
    const envKey = "CARAPACE_LAUNCHD_LABEL";
    const actual = env[envKey]?.trim();
    const expected = resolveGatewayLaunchAgentLabel(profile);
    return actual && actual !== expected ? { envKey, expected } : null;
  }
  if (platform === "linux") {
    const envKey = "CARAPACE_SYSTEMD_UNIT";
    const actual = env[envKey]?.trim();
    const normalizedActual = actual?.endsWith(".service") ? actual : actual && `${actual}.service`;
    const expected = `${resolveGatewaySystemdServiceName(profile)}.service`;
    return normalizedActual && normalizedActual !== expected ? { envKey, expected } : null;
  }
  if (platform === "win32") {
    const envKey = "CARAPACE_WINDOWS_TASK_NAME";
    const actual = env[envKey]?.trim();
    const expected = resolveGatewayWindowsTaskName(profile);
    return actual && actual !== expected ? { envKey, expected } : null;
  }
  return null;
}

function formatGatewayServiceDescription(profile?: string): string {
  const normalized = normalizeGatewayProfile(profile);
  if (!normalized) {
    return "Carapace Gateway";
  }
  return `Carapace Gateway (profile: ${normalized})`;
}

export function resolveGatewayServiceDescription(params: {
  env: Record<string, string | undefined>;
  description?: string;
}): string {
  return params.description ?? formatGatewayServiceDescription(params.env.CARAPACE_PROFILE);
}

export function resolveNodeLaunchAgentLabel(): string {
  return NODE_LAUNCH_AGENT_LABEL;
}

export function resolveNodeSystemdServiceName(): string {
  return NODE_SYSTEMD_SERVICE_NAME;
}

export function resolveNodeWindowsTaskName(): string {
  return NODE_WINDOWS_TASK_NAME;
}

export function resolveNodeServiceIdentityEnvironment(): Record<string, string> {
  return {
    CARAPACE_LAUNCHD_LABEL: resolveNodeLaunchAgentLabel(),
    CARAPACE_SYSTEMD_UNIT: resolveNodeSystemdServiceName(),
    CARAPACE_WINDOWS_TASK_NAME: resolveNodeWindowsTaskName(),
    CARAPACE_WINDOWS_TASK_HIDDEN_LAUNCHER: "1",
    CARAPACE_TASK_SCRIPT_NAME: NODE_WINDOWS_TASK_SCRIPT_NAME,
    CARAPACE_LOG_PREFIX: "node",
    CARAPACE_SERVICE_MARKER: NODE_SERVICE_MARKER,
    CARAPACE_SERVICE_KIND: NODE_SERVICE_KIND,
  };
}

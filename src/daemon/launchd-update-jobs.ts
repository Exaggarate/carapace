/** Discovery and shutdown of stale Carapace launchd updater jobs. */
import path from "node:path";
import {
  parseStrictInteger,
  parseStrictPositiveInteger,
} from "@carapace/normalization-core/number-coercion";
import {
  GATEWAY_SERVICE_KIND,
  GATEWAY_SERVICE_MARKER,
  resolveGatewayLaunchAgentLabel,
} from "./constants.js";
import { isCurrentProcessLaunchdServiceLabel } from "./launchd-current-service.js";
import { execLaunchctl } from "./launchd-exec.js";
import { assertValidLaunchAgentLabel } from "./launchd-label.js";
import { readLaunchAgentProgramArgumentsFromFile } from "./launchd-plist.js";
import { resolveLaunchAgentGuiDomain } from "./launchd-runtime.js";
import { resolveLaunchAgentPlistPathForLabel } from "./launchd-service-files.js";

const CARAPACE_UPDATE_LAUNCHD_LABEL_PREFIX = "ai.carapace.update.";
const MANUAL_UPDATE_LAUNCHD_LABEL_PATTERN = /^ai\.carapace\.manual-update\.\d+$/;
const CARAPACE_PROFILE_UPDATE_LAUNCHD_LABEL_PATTERN =
  /^ai\.carapace\.[A-Za-z0-9._-]+\.update\.[A-Za-z0-9._-]+$/;
const CARAPACE_DIRECT_CLI_NAMES = new Set(["carapace", "carapace.mjs"]);
const CARAPACE_NODE_RUNTIME_NAMES = new Set(["bun", "bun.exe", "node", "node.exe"]);
const CARAPACE_SCRIPT_NAMES = new Set(["carapace.mjs"]);
export type StaleCarapaceUpdateLaunchdJob = {
  label: string;
  pid?: number;
  lastExitStatus?: number;
};

type CarapaceUpdateLaunchdLabelCandidate = {
  label: string;
  requiresMetadata: boolean;
};

function normalizeCarapaceUpdateLaunchdLabel(label: unknown): string | null {
  if (typeof label !== "string") {
    return null;
  }
  const trimmed = label.trim();
  if (trimmed.startsWith(CARAPACE_UPDATE_LAUNCHD_LABEL_PREFIX)) {
    return trimmed;
  }
  // Manual update jobs include a timestamp-like suffix and should be cleaned up
  // without matching arbitrary ai.carapace labels.
  return MANUAL_UPDATE_LAUNCHD_LABEL_PATTERN.test(trimmed) ? trimmed : null;
}

function normalizeCarapaceUpdateLaunchdLabelCandidate(
  label: unknown,
): CarapaceUpdateLaunchdLabelCandidate | null {
  const normalized = normalizeCarapaceUpdateLaunchdLabel(label);
  if (normalized) {
    return { label: normalized, requiresMetadata: false };
  }
  if (typeof label !== "string") {
    return null;
  }
  const trimmed = label.trim();
  return CARAPACE_PROFILE_UPDATE_LAUNCHD_LABEL_PATTERN.test(trimmed)
    ? { label: trimmed, requiresMetadata: true }
    : null;
}

function isCurrentGatewayLaunchdLabel(label: string, env: NodeJS.ProcessEnv): boolean {
  const gatewayProfileLabel = resolveGatewayLaunchAgentLabel(env.CARAPACE_PROFILE);
  if (label === gatewayProfileLabel) {
    return true;
  }
  if (
    env.CARAPACE_SERVICE_MARKER?.trim() !== GATEWAY_SERVICE_MARKER ||
    env.CARAPACE_SERVICE_KIND?.trim() !== GATEWAY_SERVICE_KIND
  ) {
    return false;
  }
  const configuredLabel = env.CARAPACE_LAUNCHD_LABEL?.trim();
  return Boolean(configuredLabel && label === configuredLabel);
}

function resolveCurrentCarapaceUpdateLaunchdJobLabel(
  env: NodeJS.ProcessEnv = process.env,
): CarapaceUpdateLaunchdLabelCandidate | null {
  for (const label of [
    env.LAUNCH_JOB_LABEL,
    env.LAUNCH_JOB_NAME,
    env.XPC_SERVICE_NAME,
    env.CARAPACE_LAUNCHD_LABEL,
  ]) {
    const candidate = normalizeCarapaceUpdateLaunchdLabelCandidate(label);
    if (candidate) {
      if (isCurrentGatewayLaunchdLabel(candidate.label, env)) {
        continue;
      }
      return candidate;
    }
  }
  return null;
}

export function parseLaunchctlListCarapaceUpdateJobs(
  output: string,
): StaleCarapaceUpdateLaunchdJob[] {
  return parseLaunchctlListCarapaceUpdateJobCandidates(output)
    .filter((job) => !job.requiresMetadata)
    .map(({ requiresMetadata: _requiresMetadata, ...job }) => job);
}

function parseLaunchctlListCarapaceUpdateJobCandidates(
  output: string,
): Array<StaleCarapaceUpdateLaunchdJob & CarapaceUpdateLaunchdLabelCandidate> {
  const jobs: Array<StaleCarapaceUpdateLaunchdJob & CarapaceUpdateLaunchdLabelCandidate> = [];
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    const parts = line.split(/\s+/);
    const [pidRaw, statusRaw, ...labelParts] = parts;
    const candidate = normalizeCarapaceUpdateLaunchdLabelCandidate(labelParts.join(" "));
    if (!candidate) {
      continue;
    }
    const pid = pidRaw === "-" ? undefined : parseStrictPositiveInteger(pidRaw ?? "");
    const lastExitStatus = parseStrictInteger(statusRaw ?? "");
    jobs.push({
      label: candidate.label,
      requiresMetadata: candidate.requiresMetadata,
      ...(pid !== undefined ? { pid } : {}),
      ...(lastExitStatus !== undefined ? { lastExitStatus } : {}),
    });
  }
  return jobs.toSorted((a, b) => a.label.localeCompare(b.label));
}

function hasCarapaceUpdateLaunchdMarker(env: Record<string, string | undefined> | undefined) {
  return env?.CARAPACE_UPDATE_RUN_HANDOFF?.trim() === "1";
}

function isCarapaceUpdateCommandPrefix(programArguments: string[], updateIndex: number): boolean {
  if (updateIndex === 1) {
    const cliName = path.basename(programArguments[0] ?? "").toLowerCase();
    return CARAPACE_DIRECT_CLI_NAMES.has(cliName);
  }
  if (updateIndex !== 2) {
    return false;
  }
  const runtimeName = path.basename(programArguments[0] ?? "").toLowerCase();
  const entryName = path.basename(programArguments[1] ?? "").toLowerCase();
  return CARAPACE_NODE_RUNTIME_NAMES.has(runtimeName) && CARAPACE_SCRIPT_NAMES.has(entryName);
}

function isCarapaceUpdateProgramArguments(programArguments: string[] | undefined): boolean {
  if (!Array.isArray(programArguments) || programArguments.length === 0) {
    return false;
  }
  const updateIndex = programArguments.findIndex((arg) => arg.trim() === "update");
  if (updateIndex < 0 || !programArguments.slice(updateIndex + 1).includes("--yes")) {
    return false;
  }
  return (
    isCarapaceUpdateCommandPrefix(programArguments, updateIndex) &&
    !programArguments.some((arg) => arg.trim() === "gateway")
  );
}

async function isLaunchdJobConfirmedCarapaceUpdater(params: {
  label: string;
  env: NodeJS.ProcessEnv;
}): Promise<boolean> {
  const plistPath = resolveLaunchAgentPlistPathForLabel(params.env, params.label);
  const command = await readLaunchAgentProgramArgumentsFromFile(plistPath);
  return (
    hasCarapaceUpdateLaunchdMarker(command?.environment) ||
    isCarapaceUpdateProgramArguments(command?.programArguments)
  );
}

export async function findStaleCarapaceUpdateLaunchdJobs(
  env: NodeJS.ProcessEnv = process.env,
): Promise<StaleCarapaceUpdateLaunchdJob[]> {
  if (process.platform !== "darwin") {
    return [];
  }
  const result = await execLaunchctl(["list"]);
  if (result.code !== 0) {
    return [];
  }
  // Never report the active gateway label as stale even when a wrapper exposes
  // update-like launchd metadata through the current environment.
  const jobs: StaleCarapaceUpdateLaunchdJob[] = [];
  for (const job of parseLaunchctlListCarapaceUpdateJobCandidates(result.stdout)) {
    if (isCurrentGatewayLaunchdLabel(job.label, env)) {
      continue;
    }
    if (
      job.requiresMetadata &&
      !(await isLaunchdJobConfirmedCarapaceUpdater({ label: job.label, env }))
    ) {
      continue;
    }
    jobs.push({
      label: job.label,
      ...(job.pid !== undefined ? { pid: job.pid } : {}),
      ...(job.lastExitStatus !== undefined ? { lastExitStatus: job.lastExitStatus } : {}),
    });
  }
  return jobs;
}

async function disableCarapaceUpdateLaunchdJobCandidate(params: {
  candidate: CarapaceUpdateLaunchdLabelCandidate;
  env: NodeJS.ProcessEnv;
  trustCurrentEnvMarker: boolean;
}): Promise<boolean> {
  if (process.platform !== "darwin") {
    return false;
  }
  if (
    params.candidate.requiresMetadata &&
    !(
      (params.trustCurrentEnvMarker && hasCarapaceUpdateLaunchdMarker(params.env)) ||
      (await isLaunchdJobConfirmedCarapaceUpdater({
        label: params.candidate.label,
        env: params.env,
      }))
    )
  ) {
    return false;
  }
  const serviceTarget = `${resolveLaunchAgentGuiDomain()}/${assertValidLaunchAgentLabel(params.candidate.label)}`;
  const result = await execLaunchctl(["disable", serviceTarget]);
  return result.code === 0;
}

export async function disableCarapaceUpdateLaunchdJob(
  label: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const candidate = normalizeCarapaceUpdateLaunchdLabelCandidate(label);
  if (!candidate) {
    return false;
  }
  return await disableCarapaceUpdateLaunchdJobCandidate({
    candidate,
    env,
    trustCurrentEnvMarker: false,
  });
}

export async function disableCurrentCarapaceUpdateLaunchdJob(
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const candidate = resolveCurrentCarapaceUpdateLaunchdJobLabel(env);
  if (!candidate) {
    return false;
  }
  return await disableCarapaceUpdateLaunchdJobCandidate({
    candidate,
    env,
    // Detached handoffs preserve the configured label, so only launchd-backed
    // current-process identity may turn the ambient marker into proof.
    trustCurrentEnvMarker: isCurrentProcessLaunchdServiceLabel(candidate.label, env),
  });
}

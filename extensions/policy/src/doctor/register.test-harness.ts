// Policy tests cover register plugin behavior.
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runDoctorLintChecks,
  type HealthCheck,
  type HealthCheckContext,
  type HealthFinding,
  type HealthRepairContext,
  type CarapaceConfig,
} from "carapace/plugin-sdk/health";
import { clearHealthChecksForTest } from "carapace/plugin-sdk/plugin-test-runtime";
import { registerPolicyDoctorChecks } from "./register.js";

export let workspaceDir: string;

let originalCarapaceHome: string | undefined;

let originalCarapaceStateDir: string | undefined;

export function cfgWithPolicy(settings: Record<string, unknown> = {}): CarapaceConfig {
  return {
    plugins: {
      entries: {
        policy: {
          enabled: true,
          config: { enabled: true, ...settings },
        },
      },
    },
  };
}

type PolicyConfigFixture = CarapaceConfig & Record<string, unknown>;

export function cfgWithPolicyOverrides(
  overrides: Partial<CarapaceConfig> = {},
): PolicyConfigFixture {
  return { ...cfgWithPolicy(), ...overrides };
}

export function rawCfgWithPolicy(overrides: Record<string, unknown>): Record<string, unknown> {
  return { ...cfgWithPolicy(), ...overrides };
}

export async function writePolicyFixture(
  ...json: Parameters<typeof JSON.stringify>
): Promise<string> {
  const [policy] = json;
  const configPath = join(workspaceDir, "carapace.jsonc");
  await fs.writeFile(configPath, "{}", "utf-8");
  await fs.writeFile(
    join(workspaceDir, "policy.jsonc"),
    typeof policy === "string" ? policy : JSON.stringify(...json),
    "utf-8",
  );
  return configPath;
}

export function ctx(configPath: string, cfg: CarapaceConfig = {}): HealthCheckContext {
  return {
    mode: "lint",
    runtime: {
      log() {},
      error() {},
      exit() {},
    },
    cfg,
    cwd: workspaceDir,
    configPath,
  };
}

export function repairCtx(configPath: string, cfg: CarapaceConfig = {}): HealthRepairContext {
  return {
    ...ctx(configPath, cfg),
    mode: "fix",
  };
}

export function registerChecks(): readonly HealthCheck[] {
  const checks: HealthCheck[] = [];
  registerPolicyDoctorChecks({
    registerHealthCheck(check) {
      checks.push(check);
    },
  });
  return checks;
}

export async function runPolicyChecks(checkCtx: HealthCheckContext): Promise<{
  readonly findings: readonly HealthFinding[];
}> {
  const checks = registerChecks();
  const findings: HealthFinding[] = [];
  for (const check of checks) {
    findings.push(...(check.detect === undefined ? [] : await check.detect(checkCtx)));
  }
  return { findings };
}

export async function runPolicyChecksFixture(
  policy: unknown,
  cfg: CarapaceConfig = cfgWithPolicy(),
) {
  return runPolicyChecks(ctx(await writePolicyFixture(policy), cfg));
}

export async function runPolicyDoctorLint(
  checkCtx: HealthCheckContext,
): Promise<Awaited<ReturnType<typeof runDoctorLintChecks>>> {
  return runDoctorLintChecks(checkCtx, { checks: registerChecks() });
}

export async function runDeniedChannelRepair(repairCheckCtx: HealthRepairContext) {
  const check = registerChecks().find((entry) => entry.id === "policy/channels-denied-provider");
  if (check?.detect === undefined || check.repair === undefined) {
    throw new Error("policy channel repair check was not registered");
  }
  const findings = await check.detect(repairCheckCtx);
  const result = await check.repair(repairCheckCtx, findings);
  const config = result.config ?? repairCheckCtx.cfg;
  const remainingFindings = await check.detect({ ...repairCheckCtx, cfg: config });
  return { ...result, config, remainingFindings };
}

export async function runPolicyRepairCheck(checkId: string, repairCheckCtx: HealthRepairContext) {
  const check = registerChecks().find((entry) => entry.id === checkId);
  if (check?.detect === undefined || check.repair === undefined) {
    throw new Error(`${checkId} repair check was not registered`);
  }
  const findings = await check.detect(repairCheckCtx);
  const result = await check.repair(repairCheckCtx, findings);
  const config = result.config ?? repairCheckCtx.cfg;
  const remainingFindings =
    repairCheckCtx.dryRun === true ? [] : await check.detect({ ...repairCheckCtx, cfg: config });
  return { ...result, findings, config, remainingFindings };
}

export const setupPolicyDoctorTest = async () => {
  clearHealthChecksForTest();
  originalCarapaceHome = process.env.CARAPACE_HOME;
  originalCarapaceStateDir = process.env.CARAPACE_STATE_DIR;
  workspaceDir = await fs.mkdtemp(join(tmpdir(), "policy-doctor-"));
  process.env.CARAPACE_HOME = workspaceDir;
  delete process.env.CARAPACE_STATE_DIR;
  await fs.mkdir(join(workspaceDir, ".carapace"), { recursive: true });
  try {
    await fs.symlink(
      "../exec-approvals.json",
      join(workspaceDir, ".carapace", "exec-approvals.json"),
    );
  } catch (err) {
    if (typeof err !== "object" || err === null || !("code" in err) || err.code !== "EPERM") {
      throw err;
    }
    await fs.rm(join(workspaceDir, ".carapace"), { recursive: true, force: true });
    await fs.symlink(workspaceDir, join(workspaceDir, ".carapace"), "junction");
  }
};

export const teardownPolicyDoctorTest = async () => {
  if (originalCarapaceHome === undefined) {
    delete process.env.CARAPACE_HOME;
  } else {
    process.env.CARAPACE_HOME = originalCarapaceHome;
  }
  if (originalCarapaceStateDir === undefined) {
    delete process.env.CARAPACE_STATE_DIR;
  } else {
    process.env.CARAPACE_STATE_DIR = originalCarapaceStateDir;
  }
  await fs.rm(workspaceDir, { recursive: true, force: true });
  clearHealthChecksForTest();
};

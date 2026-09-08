// Install fixture mocks before importing the real maintenance owners.
import "./doctor-health.test-support.js";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertNoUnmigratedWorkspaceState } from "../agents/workspace-legacy-state.js";
import { readWorkspaceStateSnapshot } from "../agents/workspace-state-store.js";
import { runCommandWithRuntime } from "../cli/cli-utils.js";
import {
  maybeStopManagedServiceBeforeMutableUpdate,
  resolvePreparedGatewayUpdatePolicy,
} from "../cli/update-cli/update-command-service-maintenance.js";
import { collectSecurityWarnings } from "../commands/doctor-security.js";
import { noteSessionTranscriptHealth } from "../commands/doctor-session-transcripts.js";
import { resolveSqliteTargetFromSessionStorePath } from "../config/sessions/session-sqlite-target.js";
import type { CarapaceConfig } from "../config/types.carapace.js";
import { ExecApprovalsMigrationRequiredError } from "../infra/exec-approvals-migration-gate.js";
import {
  readExecApprovalsConfigRow,
  serializeExecApprovals,
  writeExecApprovalsConfigRow,
} from "../infra/exec-approvals-sqlite.js";
import { loadExecApprovalsReadOnly } from "../infra/exec-approvals-store.js";
import { acquireGatewayLock } from "../infra/gateway-lock.js";
import {
  resolveStateDatabaseCoordinatorPath,
  resolveStateLifecycleRuntimeDirectory,
} from "../infra/state-database-coordinator.js";
import {
  detectLegacyExecApprovals,
  migrateLegacyExecApprovals,
} from "../infra/state-migrations.exec-approvals.js";
import { migrateLegacyMediaPersistence } from "../infra/state-migrations.media-persistence.js";
import {
  detectLegacyWorkspaceState,
  migrateLegacyWorkspaceState,
} from "../infra/state-migrations.workspace-setup.js";
import { buildUpdateDoctorEnv } from "../infra/update-runner-doctor.js";
import {
  assertNoCarapaceAgentDatabaseLeases,
  claimCarapaceAgentDatabaseLease,
  releaseCarapaceAgentDatabaseLease,
} from "../state/carapace-agent-db-lease.js";
import { unregisterCarapaceAgentDatabase } from "../state/carapace-agent-db-registry.js";
import {
  closeCarapaceAgentDatabasesForTest,
  openCarapaceAgentDatabase,
  CARAPACE_AGENT_SCHEMA_VERSION,
} from "../state/carapace-agent-db.js";
import { withLegacySessionParticipantsSchema } from "../state/carapace-agent-participants-migration.js";
import { sessionParticipantsSchemaSql } from "../state/carapace-agent-session-participants-schema.js";
import { openCarapaceStateDatabase } from "../state/carapace-state-db.js";
import { resolveCarapaceStateSqlitePath } from "../state/carapace-state-db.paths.js";
import { withCarapaceTestState } from "../test-utils/carapace-test-state.js";
import type { DoctorHealthFlowContext } from "./doctor-health-contributions.js";
import { runDoctorHealthFlow } from "./doctor-health.js";

const postInstallAdvisory: NonNullable<DoctorHealthFlowContext["postInstallDoctorResult"]> = {
  status: "advisory",
  advisory: {
    kind: "package-post-install-doctor",
    message: "recoverable plugin repair",
    reason: "deferred-configured-plugin-repair",
    details: ["plugin repair deferred"],
  },
};

const { mocks, registerDoctorConfigReceiptTests } = await import("./doctor-health.test-support.js");

describe("runDoctorHealthFlow", () => {
  afterEach(() => vi.unstubAllEnvs());

  beforeEach(() => {
    mocks.config.mockReturnValue({});
    mocks.packageRoot.mockReturnValue(undefined);
    mocks.service.mockReset();
    mocks.probePortUsage.mockReset().mockResolvedValue("free");
    mocks.restartedHealthy = true;
    mocks.emulateNativeInstall = true;
    mocks.servicePlatform = undefined;
    mocks.taskDefinitelyStopped.mockReset().mockReturnValue(true);
    mocks.startupFallbackRuntime.mockReset().mockResolvedValue(null);
    mocks.outro.mockClear();
    mocks.runContributions.mockReset().mockResolvedValue(undefined);
    mocks.writeUpdatePostInstallDoctorResult.mockClear();
  });

  it.each(
    [
      "inspection-failed",
      "runtime-only",
      "owned-unknown",
      "foreign-running",
      "foreign-unknown",
      "foreign-stopped",
      "foreign-stopped-loaded",
      "foreign-stopped-loaded-disabled",
      "foreign-stopped-loaded-unknown",
      "foreign-respawning",
      "unresolved-running",
      "unresolved-unknown",
      "unresolved-stopped",
      "unresolved-stopped-loaded",
      "unresolved-respawning",
      "absent",
      "absent-unknown",
      "absent-busy-port",
      "absent-unknown-port",
      "windows-ready",
      "windows-disabled",
      "windows-queued",
      "windows-running",
      "windows-startup-stopped",
      "windows-startup-unknown",
    ].flatMap((kind) => [
      { kind, updateParent: false },
      { kind, updateParent: true },
    ]),
  )(
    "admits offline state repair only after safe service inspection: $kind (update=$updateParent)",
    async ({ kind, updateParent }) => {
      if (updateParent) {
        for (const [key, value] of Object.entries(
          buildUpdateDoctorEnv({
            allowGatewayServiceRepair: true,
            allowGatewayActivation: false,
          }),
        )) {
          vi.stubEnv(key, value);
        }
      }
      if (kind === "absent-busy-port" || kind === "absent-unknown-port") {
        mocks.probePortUsage.mockResolvedValue(kind === "absent-busy-port" ? "busy" : "unknown");
      }
      const windows = kind.startsWith("windows");
      mocks.emulateNativeInstall = kind !== "runtime-only";
      mocks.servicePlatform = windows ? "win32" : undefined;
      await withCarapaceTestState({ scenario: "minimal" }, async (state) => {
        const cfg: CarapaceConfig = {
          agents: { ownership: "explicit", entries: { main: { workspace: state.workspaceDir } } },
        };
        await state.writeConfig(cfg);
        fs.mkdirSync(state.workspaceDir, { recursive: true });
        const sourcePath = path.join(state.workspaceDir, "carapace-workspace-state.json");
        const completedAt = "2026-07-15T00:00:00.000Z";
        fs.writeFileSync(sourcePath, JSON.stringify({ version: 1, setupCompletedAt: completedAt }));
        const sourceBefore = fs.readFileSync(sourcePath);
        const configBefore = fs.readFileSync(state.configPath);
        const databasePath = resolveCarapaceStateSqlitePath(state.env);
        const coordinatorPath = resolveStateDatabaseCoordinatorPath({
          databasePath,
          runtimeDirectory: resolveStateLifecycleRuntimeDirectory(),
          uid: process.getuid?.(),
        });
        expect(fs.existsSync(databasePath)).toBe(false);
        expect(fs.existsSync(coordinatorPath)).toBe(false);

        const foreign = kind.startsWith("foreign") || windows;
        const foreignRoot = state.path("foreign-install");
        if (foreign) {
          fs.mkdirSync(foreignRoot);
          fs.writeFileSync(path.join(foreignRoot, "package.json"), '{"name":"carapace"}');
        }
        const entrypoint = kind.startsWith("unresolved")
          ? "operator-wrapper"
          : path.join(foreign ? foreignRoot : process.cwd(), "carapace.mjs");
        const stop = vi.fn();
        const restart = vi.fn();
        mocks.packageRoot.mockReturnValue(process.cwd());
        mocks.config.mockClear().mockReturnValue(cfg);
        mocks.service.mockReturnValue({
          readCommand: async () => {
            if (kind === "inspection-failed") {
              throw new Error("synthetic manager inspection failure");
            }
            return kind.startsWith("absent")
              ? null
              : {
                  programArguments: [process.execPath, entrypoint, "gateway"],
                  environment: {
                    CARAPACE_STATE_DIR: foreign ? state.path("foreign-state") : state.stateDir,
                    CARAPACE_CONFIG_PATH: foreign ? state.path("foreign.json") : state.configPath,
                  },
                };
          },
          readRuntime: async () => ({
            status:
              (kind.endsWith("unknown") && !kind.endsWith("loaded-unknown") && !windows) ||
              (kind.endsWith("respawning") && process.platform === "linux")
                ? "unknown"
                : kind.endsWith("running") && !windows
                  ? "running"
                  : "stopped",
            ...(kind.startsWith("absent") ? { missingUnit: true } : {}),
          }),
          isLoaded: async () => {
            if (kind === "absent-unknown") {
              throw new Error("synthetic manager unavailable");
            }
            return (
              windows ||
              kind.includes("stopped-loaded") ||
              kind.endsWith("running") ||
              kind.endsWith("loaded") ||
              kind.endsWith("respawning")
            );
          },
          isEnabled: async () => {
            if (kind.endsWith("loaded-unknown")) {
              throw new Error("synthetic enabled-state inspection failure");
            }
            return !kind.endsWith("loaded-disabled");
          },
          stop,
          restart,
        });
        mocks.taskDefinitelyStopped.mockReturnValue(
          windows
            ? kind === "windows-ready" || kind === "windows-disabled"
            : !kind.endsWith("respawning"),
        );
        if (kind === "windows-startup-stopped") {
          mocks.startupFallbackRuntime.mockResolvedValue({ status: "stopped" });
        } else if (kind === "windows-startup-unknown") {
          mocks.startupFallbackRuntime.mockRejectedValue(
            new Error("synthetic task inspection failure"),
          );
        }
        mocks.runContributions.mockImplementation(async (ctx) => {
          const result = await migrateLegacyWorkspaceState({
            stateDir: state.stateDir,
            env: state.env,
            detected: detectLegacyWorkspaceState({
              cfg: ctx.cfg,
              stateDir: state.stateDir,
              env: state.env,
              homedir: () => state.home,
              doctorOnlyStateMigrations: true,
            }),
          });
          expect(result.warnings).toEqual([]);
        });
        const runtime = { log: vi.fn(), error: vi.fn(), exit: vi.fn() };
        const run = runDoctorHealthFlow(runtime, { repair: true, nonInteractive: true });
        if (
          kind === "runtime-only" ||
          kind.endsWith("stopped") ||
          (kind.includes("stopped-loaded") && process.platform !== "darwin") ||
          kind === "absent" ||
          kind === "windows-ready" ||
          kind === "windows-disabled" ||
          kind.endsWith("loaded-disabled")
        ) {
          await run;
          expect(readWorkspaceStateSnapshot(state.workspaceDir).setup.setupCompletedAt).toBe(
            completedAt,
          );
          expect(fs.existsSync(sourcePath)).toBe(false);
          expect(mocks.outro).toHaveBeenCalledWith("Doctor complete.");
          if (kind !== "absent" && kind !== "runtime-only") {
            expect(runtime.log).toHaveBeenCalledWith(
              expect.stringContaining("stopped Gateway service was left unchanged"),
            );
          }
        } else {
          await expect(run).rejects.toThrow("Doctor could not enter maintenance");
          await expect(run).rejects.toThrow("gateway status --deep");
          await expect(run).rejects.toThrow("carapace doctor --fix");
          await expect(run).rejects.not.toThrow(/--no-restart|before the update/);
          expect(mocks.config).not.toHaveBeenCalled();
          expect(mocks.runContributions).not.toHaveBeenCalled();
          expect(fs.readFileSync(sourcePath)).toEqual(sourceBefore);
          expect(fs.readFileSync(state.configPath)).toEqual(configBefore);
          expect(fs.existsSync(databasePath)).toBe(false);
          expect(fs.existsSync(coordinatorPath)).toBe(false);
          expect(mocks.outro).not.toHaveBeenCalledWith("Doctor complete.");
        }
        if (kind === "absent" || kind === "absent-busy-port" || kind === "absent-unknown-port") {
          expect(mocks.probePortUsage).toHaveBeenCalledOnce();
        }
        if (windows) {
          expect(mocks.taskDefinitelyStopped).toHaveBeenCalled();
          if (kind.startsWith("windows-startup")) {
            expect(mocks.startupFallbackRuntime).toHaveBeenCalled();
          }
        }
        if (kind === "runtime-only") {
          expect(mocks.service).not.toHaveBeenCalled();
        }
        expect(stop).not.toHaveBeenCalled();
        expect(restart).not.toHaveBeenCalled();
      });
    },
  );

  it.each([
    "ready",
    "clean-repair",
    "clean-inspect",
    "clean-force-repair",
    "clean-force-inspect",
    "update-no-restart",
    "update-no-restart-stopped",
    "update-parent-stopped",
    "update-legacy",
    "repair-failed",
    "store-close-failed",
    "config-refused",
    "workspace-cleanup-failed",
    "approvals-malformed",
    "approvals-conflicting",
    "approvals-migrated",
    "restart-unhealthy",
    "ancestor-blocked",
  ] as const)(
    "coordinates the matching managed writer through multi-agent repair: %s",
    async (outcome) => {
      await withCarapaceTestState({ scenario: "minimal" }, async (state) => {
        const clean = outcome.startsWith("clean-") || outcome.startsWith("update-");
        const inspectionOnly = outcome === "clean-inspect" || outcome === "clean-force-inspect";
        const force = outcome.startsWith("clean-force-");
        const cfg: CarapaceConfig = {
          agents: {
            ownership: "explicit",
            entries: {
              main: { workspace: state.workspaceDir },
              research: { workspace: state.path("research") },
            },
          },
        };
        await state.writeConfig(
          clean
            ? cfg
            : {
                agents: {
                  list: [
                    { id: "main", workspace: state.workspaceDir },
                    { id: "research", workspace: state.path("research") },
                  ],
                },
              },
        );
        mocks.config.mockReturnValue(cfg);
        const configBefore = fs.readFileSync(state.configPath);
        const approvalsCase = outcome.startsWith("approvals-");
        const approvalsBlocked = approvalsCase && outcome !== "approvals-migrated";
        const approvalsPath = state.statePath("exec-approvals.json");
        const canonicalApprovals = {
          version: 1 as const,
          defaults: { security: "deny" as const },
          agents: {},
        };
        const approvalsBefore =
          outcome === "approvals-malformed"
            ? '{"version":1,"agents":'
            : serializeExecApprovals({ version: 1, defaults: { security: "full" }, agents: {} });
        if (approvalsCase) {
          fs.writeFileSync(approvalsPath, approvalsBefore);
          if (outcome === "approvals-conflicting") {
            writeExecApprovalsConfigRow({
              db: openCarapaceStateDatabase({ env: state.env }).db,
              file: canonicalApprovals,
            });
          }
        }
        if (outcome === "workspace-cleanup-failed") {
          fs.mkdirSync(state.workspaceDir, { recursive: true });
          fs.writeFileSync(
            path.join(state.workspaceDir, "carapace-workspace-state.json"),
            JSON.stringify({ version: 1, setupCompletedAt: "2026-07-15T00:00:00.000Z" }),
          );
        }
        const initial = openCarapaceAgentDatabase({ agentId: "main", env: state.env });
        const secondary = openCarapaceAgentDatabase({ agentId: "research", env: state.env });
        if (!clean) {
          secondary.db.exec(
            "DROP TABLE session_participants; PRAGMA user_version = 17; UPDATE schema_meta SET schema_version = 17;",
          );
          initial.db.exec(
            "DROP TABLE session_participants; PRAGMA user_version = 17; UPDATE schema_meta SET schema_version = 17;",
          );
        }
        closeCarapaceAgentDatabasesForTest();
        const leaseId = claimCarapaceAgentDatabaseLease({
          agentId: "main",
          path: initial.path,
          env: state.env,
        });
        const agentBefore = fs.readFileSync(initial.path);
        const events: string[] = [];
        let running = outcome !== "update-no-restart-stopped";
        const packageRoot = process.cwd();
        mocks.packageRoot.mockReturnValue(packageRoot);
        const command = {
          programArguments: [process.execPath, path.join(packageRoot, "carapace.mjs"), "gateway"],
          environment: {
            CARAPACE_STATE_DIR: state.stateDir,
            CARAPACE_CONFIG_PATH: state.configPath,
          },
        };
        const stop = vi.fn(async () => {
          events.push("stop");
          running = false;
          releaseCarapaceAgentDatabaseLease(leaseId, { env: state.env });
        });
        const restart = vi.fn(async () => {
          events.push("restart");
          if (outcome === "ready") {
            expect(() =>
              assertNoCarapaceAgentDatabaseLeases("main", { env: state.env }),
            ).not.toThrow();
            expect(() =>
              assertNoCarapaceAgentDatabaseLeases("research", { env: state.env }),
            ).not.toThrow();
          }
          const reopened = openCarapaceAgentDatabase({ agentId: "main", env: state.env });
          expect(reopened.db.prepare("PRAGMA user_version").get()?.user_version).toBe(
            CARAPACE_AGENT_SCHEMA_VERSION,
          );
          const research = openCarapaceAgentDatabase({ agentId: "research", env: state.env });
          expect(research.db.prepare("PRAGMA user_version").get()?.user_version).toBe(
            CARAPACE_AGENT_SCHEMA_VERSION,
          );
          running = true;
          return { outcome: "completed" as const };
        });
        mocks.service.mockReturnValue({
          readCommand: async () => command,
          readRuntime: async () => ({
            status: running ? "running" : "stopped",
            ...(outcome === "ancestor-blocked" ? { pid: process.pid } : {}),
          }),
          readLoadState: async () => ({ status: running ? "loaded" : "not-loaded" }),
          isLoaded: async () => running,
          isEnabled: async () => running,
          stop,
          restart,
        });
        mocks.runContributions.mockImplementation(async (ctx) => {
          events.push("repair");
          expect(ctx.gatewayMaintenanceActive).toBe(!inspectionOnly);
          if (clean) {
            return;
          }
          if (outcome === "repair-failed") {
            throw new Error("synthetic migration failure");
          }
          if (outcome === "config-refused") {
            ctx.configWriteRefusal = "validation";
            return;
          }
          const result = await migrateLegacyMediaPersistence();
          expect(result.warnings).toEqual([]);
          if (approvalsCase) {
            const approvals = await migrateLegacyExecApprovals({
              stateDir: state.stateDir,
              env: state.env,
              detected: detectLegacyExecApprovals({
                stateDir: state.stateDir,
                doctorOnlyStateMigrations: true,
              }),
            });
            expect(approvals.warnings.length > 0).toBe(approvalsBlocked);
            await collectSecurityWarnings(ctx.cfg, state.env);
          }
          if (outcome === "ready" || outcome === "store-close-failed") {
            // Later diagnostics reopen runtime handles after the migration closes its own.
            const reopened = openCarapaceAgentDatabase({ agentId: "main", env: state.env });
            openCarapaceAgentDatabase({ agentId: "research", env: state.env });
            if (outcome === "store-close-failed") {
              vi.spyOn(reopened.db, "close").mockImplementationOnce(() => {
                throw new Error("synthetic database close failure");
              });
            }
          }
          if (outcome === "workspace-cleanup-failed") {
            const migration = await migrateLegacyWorkspaceState({
              stateDir: state.stateDir,
              env: state.env,
              detected: detectLegacyWorkspaceState({
                cfg: ctx.cfg,
                stateDir: state.stateDir,
                env: state.env,
                homedir: () => state.home,
                doctorOnlyStateMigrations: true,
              }),
              removeSource: () => {
                throw new Error("simulated unlink failure");
              },
            });
            expect(migration.warnings.join("\n")).toContain("legacy cleanup failed");
            expect(readWorkspaceStateSnapshot(state.workspaceDir).setup.setupCompletedAt).toBe(
              "2026-07-15T00:00:00.000Z",
            );
          }
        });
        const runtime = { log: vi.fn(), error: vi.fn(), exit: vi.fn() };
        const expectCoordinatorReleased = () => {
          const coordinatorPath = resolveStateDatabaseCoordinatorPath({
            databasePath: resolveCarapaceStateSqlitePath(state.env),
            runtimeDirectory: resolveStateLifecycleRuntimeDirectory(),
            uid: process.getuid?.(),
          });
          const peer = spawnSync(process.execPath, [
            "-e",
            "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.argv[1]);db.exec('BEGIN EXCLUSIVE');db.close();",
            coordinatorPath,
          ]);
          expect(peer.status).toBe(0);
        };
        if (outcome === "config-refused") {
          runtime.exit.mockImplementation(expectCoordinatorReleased);
        }
        try {
          const modernUpdate = outcome.startsWith("update-") && outcome !== "update-legacy";
          if (modernUpdate) {
            if (!running) {
              releaseCarapaceAgentDatabaseLease(leaseId, { env: state.env });
            }
            const parentRestarts = outcome === "update-parent-stopped";
            const prepared = await maybeStopManagedServiceBeforeMutableUpdate({
              updateInstallKind: "package",
              root: packageRoot,
              shouldRestart: parentRestarts,
              jsonMode: true,
            });
            expect(prepared.stopped).toBe(parentRestarts);
            expect(running).toBe(outcome === "update-no-restart");
            expect(events).toEqual(parentRestarts ? ["stop"] : []);
            events.length = 0;
            stop.mockClear();
            const policy = resolvePreparedGatewayUpdatePolicy(prepared, parentRestarts);
            expect(policy).toEqual({
              allowGatewayServiceRepair: true,
              allowGatewayActivation: parentRestarts,
            });
            for (const [key, value] of Object.entries(buildUpdateDoctorEnv(policy))) {
              vi.stubEnv(key, value);
            }
          } else if (outcome === "update-legacy") {
            vi.stubEnv("CARAPACE_UPDATE_IN_PROGRESS", "1");
          }
          mocks.restartedHealthy = outcome !== "restart-unhealthy";
          const run = runDoctorHealthFlow(runtime, {
            ...(inspectionOnly ? {} : { repair: true }),
            force,
            nonInteractive: true,
          });
          if (outcome === "update-no-restart") {
            await expect(run).rejects.toThrow("update parent");
            expect(events).toEqual([]);
            expect(stop).not.toHaveBeenCalled();
            expect(restart).not.toHaveBeenCalled();
            expect(fs.readFileSync(state.configPath)).toEqual(configBefore);
            expect(fs.readFileSync(initial.path)).toEqual(agentBefore);
            return;
          }
          if (outcome === "ancestor-blocked") {
            await expect(run).rejects.toThrow("carapace doctor --fix");
            await expect(run).rejects.toThrow("from a shell outside the gateway service");
            await expect(run).rejects.not.toThrow("carapace update");
            expect(events).toEqual([]);
            expect(stop).not.toHaveBeenCalled();
            expect(restart).not.toHaveBeenCalled();
            expect(mocks.outro).not.toHaveBeenCalledWith("Doctor complete.");
            return;
          }
          if (outcome === "repair-failed") {
            await expect(run).rejects.toThrow("synthetic migration failure");
          } else if (outcome === "store-close-failed") {
            await expect(run).rejects.toThrow("synthetic database close failure");
            expectCoordinatorReleased();
          } else if (outcome === "workspace-cleanup-failed") {
            await expect(run).rejects.toThrow(/workspace.*requires migration/);
          } else if (approvalsBlocked) {
            await expect(run).rejects.toThrow(ExecApprovalsMigrationRequiredError);
            expectCoordinatorReleased();
          } else if (outcome === "restart-unhealthy") {
            await expect(run).rejects.toThrow("managed Gateway did not become ready");
          } else {
            await run;
          }
          if (modernUpdate) {
            expect(events.filter((event) => event !== "repair")).toEqual([]);
            expect(stop).not.toHaveBeenCalled();
            expect(restart).not.toHaveBeenCalled();
            expect(fs.readFileSync(state.configPath)).toEqual(configBefore);
            expect(fs.readFileSync(initial.path)).toEqual(agentBefore);
            return;
          }
          const shouldRestart =
            outcome === "ready" ||
            outcome === "restart-unhealthy" ||
            outcome === "clean-repair" ||
            outcome === "clean-force-repair" ||
            outcome === "approvals-migrated" ||
            outcome === "update-legacy";
          expect(events).toEqual(
            inspectionOnly
              ? ["repair"]
              : shouldRestart
                ? ["stop", "repair", "restart"]
                : ["stop", "repair"],
          );
          expect(stop).toHaveBeenCalledTimes(inspectionOnly ? 0 : 1);
          expect(restart).toHaveBeenCalledTimes(shouldRestart ? 1 : 0);
          if (shouldRestart) {
            expect(restart).toHaveBeenCalledWith(
              expect.objectContaining({ preserveDefinition: true }),
            );
          }
          if (clean) {
            expect(fs.readFileSync(state.configPath)).toEqual(configBefore);
            expect(fs.readFileSync(initial.path)).toEqual(agentBefore);
          }
          if (approvalsCase) {
            if (approvalsBlocked) {
              expect(fs.readFileSync(approvalsPath, "utf8")).toBe(approvalsBefore);
              expect(() => loadExecApprovalsReadOnly()).toThrow(
                ExecApprovalsMigrationRequiredError,
              );
            } else {
              expect(fs.existsSync(approvalsPath)).toBe(false);
              expect(loadExecApprovalsReadOnly().defaults?.security).toBe("full");
            }
            if (outcome === "approvals-conflicting") {
              expect(
                readExecApprovalsConfigRow(openCarapaceStateDatabase({ env: state.env }).db)
                  ?.raw_json,
              ).toBe(serializeExecApprovals(canonicalApprovals));
            }
          }
          if (outcome === "ready" || clean || outcome === "approvals-migrated") {
            expect(mocks.outro).toHaveBeenCalledWith("Doctor complete.");
          } else {
            expect(mocks.outro).not.toHaveBeenCalledWith("Doctor complete.");
          }
        } finally {
          releaseCarapaceAgentDatabaseLease(leaseId, { env: state.env });
        }
      });
    },
  );

  registerDoctorConfigReceiptTests(runDoctorHealthFlow, postInstallAdvisory);

  it("reports a cron ownership refusal instead of a recoverable post-install advisory", async () => {
    mocks.runContributions.mockImplementation(async (ctx) => {
      ctx.configWriteRefusal = "cron-owner-safety";
      ctx.postInstallDoctorResult = postInstallAdvisory;
    });
    const runtime = {
      log: vi.fn(),
      error: vi.fn(),
      exit: vi.fn(),
    };
    vi.stubEnv(
      "CARAPACE_UPDATE_POST_INSTALL_DOCTOR_RESULT_PATH",
      "/tmp/carapace-update-doctor-result.json",
    );

    try {
      await runDoctorHealthFlow(runtime, {});
    } finally {
      vi.unstubAllEnvs();
    }

    expect(mocks.outro).toHaveBeenCalledWith("Doctor finished, but config fixes were not applied.");
    expect(mocks.outro).not.toHaveBeenCalledWith("Doctor complete.");
    expect(runtime.exit).toHaveBeenCalledWith(1);
    expect(runtime.exit).not.toHaveBeenCalledWith(86);
    expect(mocks.writeUpdatePostInstallDoctorResult).toHaveBeenCalledWith({
      resultPath: "/tmp/carapace-update-doctor-result.json",
      result: { status: "error", configHash: "unchanged" },
    });
  });

  it.each([{ repair: true }, { yes: true }])(
    "refuses blocked required migration for %j, then completes after the writer releases",
    async (options) => {
      await withCarapaceTestState({ scenario: "minimal" }, async (state) => {
        const initial = openCarapaceAgentDatabase({ agentId: "main", env: state.env });
        initial.db.exec(
          "DROP TABLE session_participants; PRAGMA user_version = 17; UPDATE schema_meta SET schema_version = 17;",
        );
        closeCarapaceAgentDatabasesForTest();
        const before = fs.readFileSync(initial.path);
        const leaseId = claimCarapaceAgentDatabaseLease({
          agentId: "main",
          path: initial.path,
          env: state.env,
        });
        openCarapaceStateDatabase({ env: state.env }).db.exec(
          "INSERT INTO gateway_boot_lifecycle (boot_id, pid, started_at_ms, completed_at_ms, outcome, startup_reason) VALUES ('maintenance', 1, 1, 2, 'startup_failed', 'gateway.maintenance_required')",
        );
        const maintenanceOutcome = () =>
          openCarapaceStateDatabase({ env: state.env })
            .db.prepare("SELECT outcome FROM gateway_boot_lifecycle WHERE boot_id = 'maintenance'")
            .get();
        const runtime = { log: vi.fn(), error: vi.fn(), exit: vi.fn() };
        mocks.runContributions.mockImplementation(async (ctx) => {
          const result = await migrateLegacyMediaPersistence();
          ctx.runtime.log(result.warnings.join("\n"));
          if (result.warnings.length > 0 && (ctx.options.repair || ctx.options.yes)) {
            ctx.postInstallDoctorResult = postInstallAdvisory;
          }
        });
        try {
          // Diagnostic-only Doctor retains advisory behavior while the writer is live.
          await runDoctorHealthFlow(runtime, { nonInteractive: true });
          expect(mocks.outro).toHaveBeenCalledWith("Doctor complete.");
          mocks.outro.mockClear();
          vi.stubEnv(
            "CARAPACE_UPDATE_POST_INSTALL_DOCTOR_RESULT_PATH",
            state.path("advisory.json"),
          );
          await runCommandWithRuntime(runtime, () =>
            runDoctorHealthFlow(runtime, { ...options, nonInteractive: true }),
          );
          expect(runtime.exit).toHaveBeenCalledExactlyOnceWith(1);
          expect(runtime.error).toHaveBeenCalledWith(
            expect.stringMatching(
              /Doctor could not enter maintenance.*Agent main database is still open.*stop that process/,
            ),
          );
          expect(maintenanceOutcome()).toEqual({ outcome: "startup_failed" });
          expect(mocks.writeUpdatePostInstallDoctorResult).toHaveBeenCalledWith({
            resultPath: state.path("advisory.json"),
            result: { status: "error", configHash: "unchanged" },
          });
          expect(mocks.outro).not.toHaveBeenCalledWith("Doctor complete.");
          expect(fs.readFileSync(initial.path)).toEqual(before);
          expect(
            openCarapaceStateDatabase({ env: state.env })
              .db.prepare("SELECT lease_id FROM agent_database_leases WHERE lease_id = ?")
              .get(leaseId),
          ).toEqual({ lease_id: leaseId });
        } finally {
          vi.unstubAllEnvs();
          releaseCarapaceAgentDatabaseLease(leaseId, { env: state.env });
        }
        runtime.exit.mockClear();
        await runDoctorHealthFlow(runtime, { ...options, nonInteractive: true });
        expect(mocks.outro).toHaveBeenCalledWith("Doctor complete.");
        const reopened = openCarapaceAgentDatabase({ agentId: "main", env: state.env });
        expect(reopened.db.prepare("PRAGMA user_version").get()?.user_version).toBe(
          CARAPACE_AGENT_SCHEMA_VERSION,
        );
        expect(
          reopened.db.prepare("SELECT schema_version FROM schema_meta").get()?.schema_version,
        ).toBe(CARAPACE_AGENT_SCHEMA_VERSION);
        expect(runtime.exit).not.toHaveBeenCalled();
        expect(maintenanceOutcome()).toEqual({ outcome: "startup_failure_repaired" });
      });
    },
  );

  it.each(["default", "configured"])(
    "refuses failed migration of an unregistered %s store",
    async (layout) => {
      await withCarapaceTestState({ scenario: "minimal" }, async (state) => {
        const storePath =
          layout === "configured" ? state.path("custom", "sessions.json") : undefined;
        const cfg: CarapaceConfig = storePath ? { session: { store: storePath } } : {};
        mocks.config.mockReturnValue(cfg);
        const configuredPath = storePath
          ? resolveSqliteTargetFromSessionStorePath(storePath, {
              agentId: "main",
              defaultAgentId: "main",
              env: state.env,
            }).path
          : undefined;
        const initial = openCarapaceAgentDatabase({
          agentId: "main",
          env: state.env,
          ...(configuredPath ? { path: configuredPath } : {}),
        });
        initial.db.exec(
          "DROP TABLE session_participants; PRAGMA user_version = 17; UPDATE schema_meta SET schema_version = 17;",
        );
        initial.db.exec(withLegacySessionParticipantsSchema(sessionParticipantsSchemaSql()));
        initial.db.exec(
          "CREATE INDEX unknown_participant_dependency ON session_participants(actor_id);",
        );
        closeCarapaceAgentDatabasesForTest();
        unregisterCarapaceAgentDatabase({ agentId: "main", path: initial.path, env: state.env });
        const before = fs.readFileSync(initial.path);
        mocks.runContributions.mockImplementation(async (ctx) => {
          const result = await migrateLegacyMediaPersistence({
            configuredAgentDatabaseTargets: configuredPath
              ? [{ agentId: "main", path: configuredPath }]
              : [],
          });
          ctx.runtime.log(result.warnings.join("\n"));
        });
        const runtime = { log: vi.fn(), error: vi.fn(), exit: vi.fn() };
        await runCommandWithRuntime(runtime, () =>
          runDoctorHealthFlow(runtime, { repair: true, nonInteractive: true }),
        );
        expect(runtime.log).toHaveBeenCalledWith(
          expect.stringContaining("unknown indexes, views, or triggers"),
        );
        expect(runtime.exit).toHaveBeenCalledExactlyOnceWith(1);
        expect(runtime.error).toHaveBeenCalledWith(
          expect.stringMatching(/Doctor.*database readiness.*schema version 17/),
        );
        expect(mocks.outro).not.toHaveBeenCalledWith("Doctor complete.");
        expect(fs.readFileSync(initial.path)).toEqual(before);
        expect(
          openCarapaceStateDatabase({ env: state.env })
            .db.prepare("SELECT * FROM agent_databases")
            .all(),
        ).toEqual([]);
      });
    },
  );

  it("keeps archive repair failures advisory after required database migration succeeds", async () => {
    await withCarapaceTestState({ scenario: "minimal" }, async (state) => {
      openCarapaceAgentDatabase({ agentId: "main", env: state.env });
      closeCarapaceAgentDatabasesForTest();
      const archive = await state.writeText(
        "agents/main/sessions/corrupt.jsonl.deleted.2026-07-24T01-02-04.000Z",
        "invalid JSON\n",
      );
      const runtime = { log: vi.fn(), error: vi.fn(), exit: vi.fn() };
      mocks.runContributions.mockImplementation(async (ctx) => {
        const result = await migrateLegacyMediaPersistence();
        ctx.runtime.log(result.warnings.join("\n"));
      });
      await runDoctorHealthFlow(runtime, { repair: true, nonInteractive: true });
      expect(runtime.log).toHaveBeenCalledWith(
        expect.stringContaining("Skipped archived transcript media migration"),
      );
      expect(mocks.outro).toHaveBeenCalledWith("Doctor complete.");
      expect(runtime.exit).not.toHaveBeenCalled();
      expect(fs.readFileSync(archive, "utf8")).toBe("invalid JSON\n");
    });
  });

  it.each(["default", "configured"] as const)(
    "fails repair when a startup-blocking %s legacy session store remains",
    async (layout) => {
      await withCarapaceTestState({ scenario: "minimal" }, async (state) => {
        const storePath =
          layout === "configured"
            ? state.path("custom", "sessions.json")
            : state.statePath("agents", "main", "sessions", "sessions.json");
        fs.mkdirSync(path.dirname(storePath), { recursive: true });
        fs.writeFileSync(storePath, '{"agent:main:legacy":');
        mocks.config.mockReturnValue(
          layout === "configured" ? { session: { store: storePath } } : {},
        );
        const before = fs.readFileSync(storePath);
        const runtime = { log: vi.fn(), error: vi.fn(), exit: vi.fn() };

        await runCommandWithRuntime(runtime, () =>
          runDoctorHealthFlow(runtime, { repair: true, nonInteractive: true }),
        );

        expect(runtime.exit).toHaveBeenCalledExactlyOnceWith(1);
        expect(runtime.error).toHaveBeenCalledWith(
          expect.stringContaining("Legacy session store requires migration"),
        );
        expect(mocks.outro).not.toHaveBeenCalledWith("Doctor complete.");
        expect(fs.readFileSync(storePath)).toEqual(before);
      });
    },
  );

  it("fails public repair after the Gateway lock skips session import", async () => {
    await withCarapaceTestState({ scenario: "minimal" }, async (state) => {
      const storePath = await state.writeText(
        "agents/main/sessions/sessions.json",
        JSON.stringify({
          "agent:main:legacy": { sessionId: "legacy-session", updatedAt: 1 },
        }),
      );
      const before = fs.readFileSync(storePath);
      const gatewayLock = await acquireGatewayLock({
        allowInTests: true,
        env: state.env,
        port: 19566,
      });
      if (!gatewayLock) {
        throw new Error("expected Gateway lock");
      }
      mocks.runContributions.mockImplementation(async (ctx) => {
        await noteSessionTranscriptHealth({
          cfg: ctx.cfg,
          env: state.env,
          shouldRepair: true,
        });
      });
      const runtime = { log: vi.fn(), error: vi.fn(), exit: vi.fn() };

      try {
        await runCommandWithRuntime(runtime, () =>
          runDoctorHealthFlow(runtime, { repair: true, nonInteractive: true }),
        );
      } finally {
        await gatewayLock.release();
      }

      expect(runtime.exit).toHaveBeenCalledExactlyOnceWith(1);
      expect(runtime.error).toHaveBeenCalledWith(
        expect.stringContaining("Legacy session store requires migration"),
      );
      expect(mocks.outro).not.toHaveBeenCalledWith("Doctor complete.");
      expect(fs.readFileSync(storePath)).toEqual(before);
    });
  });

  it.each(["configured", "sandbox"] as const)(
    "refuses incomplete %s workspace cleanup with current SQLite schemas, then completes on retry",
    async (kind) => {
      await withCarapaceTestState({ scenario: "minimal" }, async (state) => {
        const workspaceDir = state.statePath("secondary-workspace");
        const cfg: CarapaceConfig = {
          agents: {
            ownership: "explicit",
            entries: {
              primary: { workspace: state.workspaceDir },
              secondary:
                kind === "configured"
                  ? { workspace: workspaceDir }
                  : {
                      workspace: state.path("secondary-host-workspace"),
                      sandbox: {
                        mode: "all",
                        scope: "shared",
                        workspaceRoot: workspaceDir,
                        workspaceAccess: "none",
                      },
                    },
            },
          },
        };
        mocks.config.mockReturnValue(cfg);
        const sourcePath = await state.writeJson(
          "secondary-workspace/carapace-workspace-state.json",
          {
            version: 1,
            setupCompletedAt: "2026-07-15T00:00:00.000Z",
          },
        );
        openCarapaceStateDatabase({ env: state.env });
        let failCleanup = true;
        mocks.runContributions.mockImplementation(async (ctx) => {
          const result = await migrateLegacyWorkspaceState({
            stateDir: state.stateDir,
            env: state.env,
            detected: detectLegacyWorkspaceState({
              cfg: ctx.cfg,
              stateDir: state.stateDir,
              env: state.env,
              homedir: () => state.home,
              doctorOnlyStateMigrations: true,
            }),
            ...(failCleanup
              ? {
                  removeSource: () => {
                    throw new Error("simulated unlink failure");
                  },
                }
              : {}),
          });
          ctx.runtime.log(result.warnings.join("\n"));
        });
        const runtime = { log: vi.fn(), error: vi.fn(), exit: vi.fn() };
        await runCommandWithRuntime(runtime, () =>
          runDoctorHealthFlow(runtime, { repair: true, nonInteractive: true }),
        );
        expect(runtime.log).toHaveBeenCalledWith(expect.stringContaining("legacy cleanup failed"));
        expect(readWorkspaceStateSnapshot(workspaceDir).setup.setupCompletedAt).toBe(
          "2026-07-15T00:00:00.000Z",
        );
        expect(fs.existsSync(`${sourcePath}.doctor-importing`)).toBe(true);
        expect(() => assertNoUnmigratedWorkspaceState({ workspaceDir })).toThrow(
          /requires migration/,
        );
        expect(runtime.exit).toHaveBeenCalledExactlyOnceWith(1);
        expect(runtime.error).toHaveBeenCalledWith(
          expect.stringMatching(/workspace.*requires migration/),
        );
        expect(mocks.outro).not.toHaveBeenCalledWith("Doctor complete.");

        failCleanup = false;
        runtime.exit.mockClear();
        await runDoctorHealthFlow(runtime, { repair: true, nonInteractive: true });
        expect(mocks.outro).toHaveBeenCalledWith("Doctor complete.");
        expect(runtime.exit).not.toHaveBeenCalled();
        expect(fs.existsSync(`${sourcePath}.doctor-importing`)).toBe(false);
        expect(() => assertNoUnmigratedWorkspaceState({ workspaceDir })).not.toThrow();
      });
    },
  );

  it.each(["missing-state", "missing-agent", "current"])(
    "accepts %s databases without creating or repairing them",
    async (scenario) => {
      await withCarapaceTestState({ scenario: "minimal" }, async (state) => {
        let agentPath: string | undefined;
        if (scenario !== "missing-state") {
          agentPath = openCarapaceAgentDatabase({ agentId: "main", env: state.env }).path;
          closeCarapaceAgentDatabasesForTest();
          if (scenario === "missing-agent") {
            fs.unlinkSync(agentPath);
          }
        }
        const before =
          agentPath && fs.existsSync(agentPath) ? fs.readFileSync(agentPath) : undefined;
        const runtime = { log: vi.fn(), error: vi.fn(), exit: vi.fn() };
        await runDoctorHealthFlow(runtime, { repair: true, nonInteractive: true });
        expect(mocks.outro).toHaveBeenCalledWith("Doctor complete.");
        expect(runtime.exit).not.toHaveBeenCalled();
        if (agentPath && before) {
          expect(fs.readFileSync(agentPath)).toEqual(before);
        } else {
          expect(fs.existsSync(agentPath ?? resolveCarapaceStateSqlitePath(state.env))).toBe(false);
        }
      });
    },
  );
});

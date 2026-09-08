import { fork, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toStructuredErrorObject } from "@carapace/normalization-core/error-coercion";
import { runtimeProcessEntrypoints } from "../infra/runtime-process-entrypoints.js";
import { resolveRuntimeWorkerUrl } from "../infra/runtime-worker-url.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import {
  confirmCarapaceAgentDatabaseIntegrity,
  listCarapaceRegisteredAgentDatabases,
  recordCarapaceAgentDatabaseOpenFailure,
} from "./carapace-agent-db.js";
import type {
  CarapaceDatabaseVerifyResult,
  CarapaceDatabaseVerifyTarget,
} from "./carapace-database-verify.worker.js";
import { recordCarapaceDatabaseQuarantine } from "./carapace-quarantine-store.js";
import {
  confirmCarapaceStateDatabaseIntegrity,
  recordCarapaceStateDatabaseOpenFailure,
} from "./carapace-state-db.js";
import { resolveCarapaceStateSqlitePath } from "./carapace-state-db.paths.js";

export const CARAPACE_DATABASE_VERIFY_INITIAL_DELAY_MS = 5 * 60_000;
export const CARAPACE_DATABASE_VERIFY_INTERVAL_MS = 24 * 60 * 60_000;

const log = createSubsystemLogger("state/database-verify");
const DATABASE_VERIFY_CHILD_ARG = "--carapace-database-verify-child";

function isVerifyResult(value: unknown): value is CarapaceDatabaseVerifyResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const result = value as Record<string, unknown>;
  return (
    typeof result.path === "string" &&
    typeof result.ok === "boolean" &&
    (result.error === undefined || typeof result.error === "string") &&
    (result.terminal === undefined || typeof result.terminal === "boolean")
  );
}

export function runDatabaseVerifyWorker(
  targets: readonly CarapaceDatabaseVerifyTarget[],
  options: { onWorker?: (worker: ChildProcess | undefined) => void; workerUrl?: URL } = {},
): Promise<CarapaceDatabaseVerifyResult[]> {
  const workerUrl =
    options.workerUrl ?? resolveRuntimeWorkerUrl(runtimeProcessEntrypoints.databaseVerify);
  const execArgv = workerUrl.pathname.endsWith(".ts") ? ["--import", "tsx"] : undefined;
  let worker: ChildProcess;
  try {
    // Snapshot preparation opens and closes raw source descriptors. Isolate it
    // because POSIX close() can release the Gateway's process-owned SQLite locks.
    worker = fork(fileURLToPath(workerUrl), [DATABASE_VERIFY_CHILD_ARG], {
      execArgv,
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
  } catch (error) {
    return Promise.reject(toStructuredErrorObject(error));
  }
  options.onWorker?.(worker);

  return new Promise((resolve, reject) => {
    let settled = false;
    let result: CarapaceDatabaseVerifyResult[] | undefined;
    let protocolError: Error | undefined;
    let exit: { code: number | null; signal: NodeJS.Signals | null } | undefined;
    let disconnected = !worker.connected;
    const settle = (finish: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      worker.removeAllListeners();
      options.onWorker?.(undefined);
      finish();
    };
    const settleAfterExitAndDisconnect = () => {
      const completedExit = exit;
      if (!completedExit || !disconnected) {
        return;
      }
      settle(() => {
        if (protocolError) {
          reject(toStructuredErrorObject(protocolError));
        } else if (completedExit.code !== 0) {
          reject(
            new Error(
              `database verification worker exited with ${
                completedExit.signal
                  ? `signal ${completedExit.signal}`
                  : `code ${completedExit.code}`
              }`,
            ),
          );
        } else if (!result) {
          reject(new Error("database verification worker exited without results"));
        } else {
          resolve(result);
        }
      });
    };
    worker.once("message", (message: unknown) => {
      if (!Array.isArray(message) || !message.every(isVerifyResult)) {
        protocolError = new Error("database verification worker returned invalid results");
        worker.kill();
        return;
      }
      result = message;
    });
    worker.once("error", (error) => settle(() => reject(toStructuredErrorObject(error))));
    worker.once("disconnect", () => {
      disconnected = true;
      settleAfterExitAndDisconnect();
    });
    worker.once("exit", (code, signal) => {
      exit = { code, signal };
      disconnected ||= !worker.connected;
      settleAfterExitAndDisconnect();
    });
    worker.send(targets, (error) => {
      if (!error) {
        return;
      }
      worker.kill();
      settle(() => reject(toStructuredErrorObject(error)));
    });
  });
}

export async function terminateDatabaseVerifyWorker(worker: ChildProcess): Promise<void> {
  if (worker.exitCode !== null || worker.signalCode !== null) {
    return;
  }
  await new Promise<void>((resolve) => {
    worker.once("exit", () => resolve());
    if (!worker.kill()) {
      resolve();
    }
  });
}

/** Resolve the state database and current registered agent database paths. */
export function collectCarapaceDatabaseVerifyTargets(options: {
  env: NodeJS.ProcessEnv;
}): CarapaceDatabaseVerifyTarget[] {
  const targets = new Map<string, CarapaceDatabaseVerifyTarget>();
  const statePath = path.resolve(resolveCarapaceStateSqlitePath(options.env));
  if (existsSync(statePath)) {
    targets.set(statePath, { kind: "state", label: "Carapace state database", path: statePath });
  }
  let registeredDatabases: ReturnType<typeof listCarapaceRegisteredAgentDatabases> = [];
  try {
    registeredDatabases = listCarapaceRegisteredAgentDatabases({ env: options.env });
  } catch (error) {
    log.warn("failed to collect registered agent databases for integrity verification", {
      error: String(error),
    });
  }
  for (const registered of registeredDatabases) {
    const agentPath = path.resolve(registered.path);
    if (!existsSync(agentPath) || targets.has(agentPath)) {
      continue;
    }
    targets.set(agentPath, {
      kind: "agent",
      label: `Carapace agent database ${registered.agentId}`,
      path: agentPath,
    });
  }
  return [...targets.values()];
}

/** Reconfirm worker failures on live owners before quarantine and latching. */
export function applyCarapaceDatabaseVerificationResults(options: {
  env: NodeJS.ProcessEnv;
  results: readonly CarapaceDatabaseVerifyResult[];
  targets: readonly CarapaceDatabaseVerifyTarget[];
}): void {
  const targetByPath = new Map(options.targets.map((target) => [target.path, target]));

  for (const result of options.results) {
    const target = targetByPath.get(result.path);
    if (!target) {
      continue;
    }
    if (result.ok) {
      log.info("database integrity verification passed", {
        kind: target.kind,
        label: target.label,
        path: result.path,
      });
      continue;
    }
    if (!result.terminal) {
      log.warn("database integrity verification was inconclusive", {
        kind: target.kind,
        label: target.label,
        path: result.path,
        error: result.error,
      });
      continue;
    }
    const confirmation =
      target.kind === "state"
        ? confirmCarapaceStateDatabaseIntegrity(result.path)
        : confirmCarapaceAgentDatabaseIntegrity(result.path);
    if (confirmation.status === "healthy") {
      log.info("discarding stale database integrity verification result", {
        kind: target.kind,
        label: target.label,
        path: result.path,
      });
      continue;
    }
    if (!confirmation.terminal) {
      log.warn("database integrity verification was inconclusive", {
        kind: target.kind,
        label: target.label,
        path: result.path,
        error: confirmation.error.message,
      });
      continue;
    }
    const latched =
      target.kind === "state"
        ? recordCarapaceStateDatabaseOpenFailure(
            result.path,
            confirmation.error,
            confirmation.generation,
          )
        : recordCarapaceAgentDatabaseOpenFailure(
            result.path,
            confirmation.error,
            confirmation.generation,
          );
    if (!latched) {
      log.info("discarding database integrity result after database generation changed", {
        kind: target.kind,
        label: target.label,
        path: result.path,
      });
      continue;
    }
    const recorded = recordCarapaceDatabaseQuarantine({
      env: options.env,
      generation: confirmation.generation,
      kind: target.kind,
      path: result.path,
      reason: confirmation.error.message,
    });
    if (!recorded) {
      // Store unavailable. Daily verification retries persistence.
      log.error("failed to persist database quarantine; quarantine is process-local", {
        kind: target.kind,
        path: result.path,
      });
    }
    log.error("database integrity verification failed", {
      kind: target.kind,
      label: target.label,
      path: result.path,
      error: confirmation.error.message,
    });
  }
}

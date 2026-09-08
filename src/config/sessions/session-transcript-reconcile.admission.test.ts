import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { afterEach, expect, it, vi } from "vitest";
import { createDeferred } from "../../../test/helpers/promise.js";
import * as sqlite from "../../infra/node-sqlite.js";
import * as integrity from "../../infra/sqlite-integrity-worker.js";
import { withCarapaceAgentDatabaseReadOnly } from "../../state/carapace-agent-db-readonly.js";
import {
  closeCarapaceAgentDatabaseByPath,
  closeCarapaceAgentDatabasesAsync,
  closeCarapaceAgentDatabasesForTest,
  openCarapaceAgentDatabase,
} from "../../state/carapace-agent-db.js";
import { closeCarapaceStateDatabaseForTest } from "../../state/carapace-state-db.js";
import { persistSessionTranscriptTurn } from "./session-accessor.js";
import {
  reconcileSessionTranscriptIndexes,
  startSessionTranscriptIndexReconcile,
  waitForSessionTranscriptIndexReconcile,
  waitForSessionTranscriptIndexReconcilesInStateDir,
  waitForSessionTranscriptProjection,
} from "./session-transcript-reconcile.js";
import type { SessionTranscriptReconcileWorkerInput } from "./session-transcript-reconcile.worker.js";

const roots: string[] = [];
const realOpen = sqlite.openNodeSqliteDatabase;

afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots) {
    await waitForSessionTranscriptIndexReconcilesInStateDir(root);
  }
  await closeCarapaceAgentDatabasesAsync();
  closeCarapaceAgentDatabasesForTest();
  closeCarapaceStateDatabaseForTest();
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reconcile-admission-"));
  roots.push(root);
  vi.stubEnv("CARAPACE_STATE_DIR", root);
  const options = { agentId: "main", env: { ...process.env, CARAPACE_STATE_DIR: root } };
  const scope = { ...options, sessionId: "cold", sessionKey: "agent:main:cold" };
  await persistSessionTranscriptTurn(scope, {
    messages: [{ eventId: "seed", message: { role: "user", content: "cold admission fixture" } }],
    touchSessionEntry: false,
  });
  await waitForSessionTranscriptIndexReconcile(options);
  const database = openCarapaceAgentDatabase(options);
  database.db.prepare("UPDATE session_transcript_index_state SET needs_rebuild = 1").run();
  closeCarapaceAgentDatabaseByPath(database.path);
  return {
    root,
    options: { ...options, path: database.path },
    scope: { ...scope, storePath: database.path },
  };
}

it("waits for a cold projection without superseding its native integrity admission", async () => {
  const { options, scope } = await fixture();
  let parentChecks = 0;
  vi.spyOn(sqlite, "openNodeSqliteDatabase").mockImplementation((pathname, openOptions) => {
    const database = realOpen(pathname, openOptions);
    if (pathname === options.path && !openOptions?.readOnly) {
      const prepare = database.prepare.bind(database);
      database.prepare = (sql) => {
        const statement = prepare(sql);
        if (sql === "PRAGMA integrity_check;") {
          const all = statement.all.bind(statement);
          statement.all = () => {
            parentChecks += 1;
            return all();
          };
        }
        return statement;
      };
    }
    return database;
  });
  const entered = createDeferred();
  const check = integrity.assertSqliteIntegrityInWorker;
  vi.spyOn(integrity, "assertSqliteIntegrityInWorker").mockImplementation((...args) => {
    const result = check(...args);
    entered.resolve();
    return result;
  });
  startSessionTranscriptIndexReconcile(options);
  await entered.promise;
  await waitForSessionTranscriptProjection(scope);
  await waitForSessionTranscriptIndexReconcile(options);
  expect(parentChecks).toBe(0);
  expect(
    withCarapaceAgentDatabaseReadOnly(
      ({ db }) => db.prepare("SELECT needs_rebuild FROM session_transcript_index_state").get(),
      options,
    ),
  ).toEqual({ found: true, value: { needs_rebuild: 0 } });
});

it.each(["direct", "deferred"] as const)(
  "retains the operation environment before %s admission",
  async (mode) => {
    const { options } = await fixture();
    const nextRoot = fs.mkdtempSync(path.join(os.tmpdir(), "reconcile-next-owner-"));
    roots.push(nextRoot);
    const original = { ...options, env: { ...options.env } };
    const inputs: SessionTranscriptReconcileWorkerInput[] = [];
    const params = {
      ...options,
      createWorker: (
        filename: string | URL,
        workerOptions: import("node:worker_threads").WorkerOptions,
      ) => {
        inputs.push(workerOptions.workerData as SessionTranscriptReconcileWorkerInput);
        return new Worker(filename, workerOptions);
      },
    };
    const task = mode === "direct" ? reconcileSessionTranscriptIndexes(params) : undefined;
    if (mode === "deferred") {
      startSessionTranscriptIndexReconcile(params);
    }
    options.env.CARAPACE_STATE_DIR = nextRoot;
    if (task) {
      await expect(task).resolves.toEqual({ reconciledSessions: 1 });
    } else {
      await waitForSessionTranscriptIndexReconcile(original);
    }
    expect(inputs).toContainEqual(
      expect.objectContaining({ mode: "disk", stateDir: original.env.CARAPACE_STATE_DIR }),
    );
    expect(fs.readdirSync(nextRoot)).toEqual([]);
  },
);

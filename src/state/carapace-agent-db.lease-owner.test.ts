import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTempDirTracker } from "../../test/helpers/temp-dir.js";
import * as nodeSqlite from "../infra/node-sqlite.js";
import {
  closeCarapaceAgentDatabaseByPath,
  closeCarapaceAgentDatabasesForTest,
  getCarapaceAgentDatabaseIfOpen,
  listCarapaceRegisteredAgentDatabases,
  openCarapaceAgentDatabase,
  recordCarapaceAgentDatabaseOpenFailure,
  settleCarapaceAgentDatabaseWorkerClose,
  withCarapaceAgentDatabaseAdmission,
  type CarapaceAgentDatabaseWriteAdmission,
} from "./carapace-agent-db.js";
import {
  closeCarapaceStateDatabaseForTest,
  openCarapaceStateDatabase,
} from "./carapace-state-db.js";
import { claimCarapaceStateOwnership } from "./carapace-state-ownership-operations.js";

const tempDirs = createTempDirTracker();
const connections: DatabaseSync[] = [];
const admitted: CarapaceAgentDatabaseWriteAdmission = async (run) => run(() => {});

afterEach(() => {
  vi.restoreAllMocks();
  closeCarapaceAgentDatabasesForTest();
  for (const connection of connections.splice(0)) {
    if (connection.isOpen) {
      connection.close();
    }
  }
  closeCarapaceStateDatabaseForTest();
  vi.unstubAllEnvs();
  tempDirs.cleanup();
});

function createOwner() {
  const stateDir = tempDirs.make("agent-lease-owner-");
  const nextStateDir = tempDirs.make("agent-lease-next-");
  const env: NodeJS.ProcessEnv = { CARAPACE_STATE_DIR: stateDir };
  const state = openCarapaceStateDatabase({ env });
  const leases = () => state.db.prepare("SELECT lease_id FROM agent_database_leases").all();
  return { stateDir, nextStateDir, env, leases };
}

describe("agent database lease acquisition owner", () => {
  it("rejects initial authority denial without creating a database or changing its directory", async () => {
    const owner = createOwner();
    const directory = path.join(owner.stateDir, "custom");
    fs.mkdirSync(directory);
    fs.chmodSync(directory, 0o750);
    const mode = fs.statSync(directory).mode;
    const options = {
      agentId: "worker",
      env: owner.env,
      path: path.join(directory, "agent.sqlite"),
    };
    const denied = new Error("synthetic write authority revoked");
    const operation = vi.fn();

    await expect(
      withCarapaceAgentDatabaseAdmission(
        options,
        async (run) =>
          run(() => {
            throw denied;
          }),
        operation,
      ),
    ).rejects.toMatchObject({ message: denied.message, cause: denied });

    expect(operation).not.toHaveBeenCalled();
    expect(fs.readdirSync(directory)).toEqual([]);
    expect(fs.statSync(directory).mode).toBe(mode);
    expect(owner.leases()).toEqual([]);
    expect(getCarapaceAgentDatabaseIfOpen(options)).toBeUndefined();
    await expect(
      withCarapaceAgentDatabaseAdmission(options, admitted, (database) => database.agentId),
    ).resolves.toBe(options.agentId);
  });

  it("unwinds an unfinished physical open when the scheduler rejects the next permit", async () => {
    const owner = createOwner();
    const options = { agentId: "worker", env: owner.env };
    const original = openCarapaceAgentDatabase(options);
    original.db.exec(`
      INSERT INTO cache_entries (scope,key,value_json,expires_at,updated_at)
        VALUES ('admission','retained','{"retained":true}',100,1);
      DROP INDEX idx_agent_cache_expiry;
    `);
    expect(closeCarapaceAgentDatabaseByPath(original.path)).toBe(true);
    const nativeOpen = nodeSqlite.openNodeSqliteDatabase;
    let opened: DatabaseSync | undefined;
    const open = vi
      .spyOn(nodeSqlite, "openNodeSqliteDatabase")
      .mockImplementation((location, config) => {
        const connection = nativeOpen(location, config);
        if (location === original.path) {
          opened = connection;
          connections.push(connection);
        }
        return connection;
      });
    const lostScheduler = new Error("synthetic parent closed during database admission");
    let permits = 0;
    const withAdmission: CarapaceAgentDatabaseWriteAdmission = async (run) => {
      if (++permits === 2) {
        expect(owner.leases()).toHaveLength(1);
        expect(opened?.isOpen).toBe(true);
        throw lostScheduler;
      }
      return run(() => {});
    };
    const operation = vi.fn();

    await expect(
      withCarapaceAgentDatabaseAdmission(options, withAdmission, operation),
    ).rejects.toBe(lostScheduler);

    expect(permits).toBe(2);
    expect(operation).not.toHaveBeenCalled();
    expect(opened?.isOpen).toBe(false);
    expect(getCarapaceAgentDatabaseIfOpen(options)).toBeUndefined();
    expect(owner.leases()).toEqual([]);
    open.mockRestore();
    const retained = nativeOpen(original.path, { readOnly: true });
    try {
      expect(
        retained.prepare("SELECT sql FROM sqlite_schema WHERE name='idx_agent_cache_expiry'").get(),
      ).toBeUndefined();
      expect(retained.prepare("SELECT * FROM cache_entries").all()).toEqual([
        {
          scope: "admission",
          key: "retained",
          value_json: '{"retained":true}',
          blob: null,
          expires_at: 100,
          updated_at: 1,
        },
      ]);
    } finally {
      retained.close();
    }
    await expect(
      withCarapaceAgentDatabaseAdmission(options, admitted, (database) => database.agentId),
    ).resolves.toBe(options.agentId);
  });

  it("resets a recreated fixture root without retiring another root", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const owner = createOwner();
    const env = owner.env;
    const otherEnv = { CARAPACE_STATE_DIR: owner.nextStateDir };
    const closed = openCarapaceAgentDatabase({ agentId: "closed", env });
    closeCarapaceAgentDatabaseByPath(closed.path);
    const active = openCarapaceAgentDatabase({ agentId: "active", env });
    const other = openCarapaceAgentDatabase({ agentId: "other", env: otherEnv });
    const failedPath = path.join(owner.stateDir, "failed.sqlite");
    const otherFailedPath = path.join(owner.nextStateDir, "failed.sqlite");
    const failure = new Error("fixture open failure");
    recordCarapaceAgentDatabaseOpenFailure(failedPath, failure);
    recordCarapaceAgentDatabaseOpenFailure(otherFailedPath, failure);

    closeCarapaceAgentDatabasesForTest(owner.stateDir);

    expect(active.db.isOpen).toBe(false);
    expect(owner.leases()).toEqual([]);
    expect(other.db.isOpen).toBe(true);
    expect(openCarapaceAgentDatabase({ agentId: "other", env: otherEnv })).toBe(other);
    expect(() =>
      openCarapaceAgentDatabase({ agentId: "failed", env: otherEnv, path: otherFailedPath }),
    ).toThrow(failure);
    expect(openCarapaceAgentDatabase({ agentId: "failed", env, path: failedPath }).db.isOpen).toBe(
      true,
    );

    now.mockReturnValue(2_000);
    openCarapaceAgentDatabase({ agentId: closed.agentId, env });
    expect(
      listCarapaceRegisteredAgentDatabases({ env }).find((entry) => entry.path === closed.path),
    ).toMatchObject({ lastSeenAt: 2_000 });
  });

  it.each([
    { kind: "ambient environment", ambient: true, external: false, worker: false },
    { kind: "mutated explicit environment", ambient: false, external: false, worker: false },
    { kind: "removed external supervision marker", ambient: false, external: true, worker: false },
    {
      kind: "Worker settlement after environment mutation",
      ambient: false,
      external: false,
      worker: true,
    },
  ])("releases the original lease with $kind", ({ ambient, external, worker }) => {
    const owner = createOwner();
    if (external) {
      owner.env.CARAPACE_SUPERVISOR_MODE = "external";
      claimCarapaceStateOwnership("fixture-supervisor", { env: owner.env });
    }
    vi.stubEnv("CARAPACE_STATE_DIR", owner.stateDir);
    vi.stubEnv("CARAPACE_AGENT_DIR", undefined);
    const database = openCarapaceAgentDatabase({
      agentId: "main",
      ...(ambient ? {} : { env: owner.env }),
    });
    expect(owner.leases()).toHaveLength(1);
    try {
      if (external) {
        delete owner.env.CARAPACE_SUPERVISOR_MODE;
      } else {
        owner.env.CARAPACE_STATE_DIR = owner.nextStateDir;
        vi.stubEnv("CARAPACE_STATE_DIR", owner.nextStateDir);
      }
      expect(fs.readdirSync(owner.nextStateDir)).toEqual([]);
      if (worker) {
        expect(settleCarapaceAgentDatabaseWorkerClose(database.path)).toEqual({
          errors: [],
          settled: true,
        });
      } else if (ambient) {
        closeCarapaceAgentDatabasesForTest();
      } else {
        expect(closeCarapaceAgentDatabaseByPath(database.path)).toBe(true);
      }
      expect(database.db.isOpen).toBe(false);
      expect(owner.leases()).toEqual([]);
      expect(fs.readdirSync(owner.nextStateDir)).toEqual([]);
    } finally {
      owner.env.CARAPACE_STATE_DIR = owner.stateDir;
      if (external) {
        owner.env.CARAPACE_SUPERVISOR_MODE = "external";
      }
      vi.stubEnv("CARAPACE_STATE_DIR", owner.stateDir);
    }
  });

  it.each([false, true])(
    "releases a failed open in its original store (retained handle: %s)",
    (retainHandle) => {
      const owner = createOwner();
      const database = openCarapaceAgentDatabase({ agentId: "main", env: owner.env });
      expect(closeCarapaceAgentDatabaseByPath(database.path)).toBe(true);
      const nativeOpen = nodeSqlite.openNodeSqliteDatabase;
      const open = vi
        .spyOn(nodeSqlite, "openNodeSqliteDatabase")
        .mockImplementation((location, options) => {
          const connection = nativeOpen(location, options);
          if (location === database.path) {
            open.mockRestore();
            const close = connection.close.bind(connection);
            vi.spyOn(connection, "close").mockImplementationOnce(() => {
              // Change the caller's environment after claim, during failed-open cleanup.
              owner.env.CARAPACE_STATE_DIR = owner.nextStateDir;
              if (retainHandle) {
                throw new Error("fixture close failure");
              }
              close();
            });
          }
          return connection;
        });
      try {
        expect(() =>
          openCarapaceAgentDatabase({ agentId: "other", env: owner.env, path: database.path }),
        ).toThrow(retainHandle ? "fixture close failure" : "belongs to agent main");
        open.mockRestore();
        if (retainHandle) {
          expect(owner.leases()).toHaveLength(1);
          expect(closeCarapaceAgentDatabaseByPath(database.path)).toBe(true);
        }
        expect(owner.leases()).toEqual([]);
        expect(fs.readdirSync(owner.nextStateDir)).toEqual([]);
      } finally {
        open.mockRestore();
        owner.env.CARAPACE_STATE_DIR = owner.stateDir;
      }
    },
  );
});

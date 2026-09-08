// Agent database cache tests cover bounded process-local SQLite handle ownership.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { requireNodeSqlite } from "../infra/node-sqlite.js";
import { createDeferredCore } from "../shared/deferred.js";
import { releaseCarapaceAgentDatabaseLease } from "./carapace-agent-db-lease.js";
import { retainCarapaceAgentDatabaseReadOnly } from "./carapace-agent-db-readonly.js";
import {
  borrowCarapaceAgentDatabase,
  closeCarapaceAgentDatabaseByPath,
  closeCarapaceAgentDatabasesForTest,
  disposeCarapaceAgentDatabaseByPath,
  isCarapaceAgentDatabaseOpen,
  listCarapaceAgentDatabasesForTest,
  listCarapaceRegisteredAgentDatabases,
  CARAPACE_AGENT_DB_OPEN_HANDLE_CAP,
  openCarapaceAgentDatabase,
  runCarapaceAgentWriteTransaction,
  withCarapaceAgentDatabaseAsync,
} from "./carapace-agent-db.js";
import {
  closeCarapaceStateDatabaseForTest,
  openCarapaceStateDatabase,
} from "./carapace-state-db.js";

const BASE_AGENT_IDS = Array.from(
  { length: CARAPACE_AGENT_DB_OPEN_HANDLE_CAP },
  (_, index) => `fixture-${index}`,
);
const BASE_AGENT_ID_SET = new Set(BASE_AGENT_IDS);

let fixtureEnv: NodeJS.ProcessEnv | undefined;
let fixtureStateDir: string | undefined;
let baseDatabases: ReturnType<typeof openCarapaceAgentDatabase>[] = [];

function requireFixtureEnv(): NodeJS.ProcessEnv {
  if (!fixtureEnv) {
    throw new Error("agent database cache fixture was not initialized");
  }
  return fixtureEnv;
}

function restoreBaseCache(): void {
  const env = requireFixtureEnv();
  for (const database of listCarapaceAgentDatabasesForTest()) {
    if (!BASE_AGENT_ID_SET.has(database.agentId)) {
      closeCarapaceAgentDatabaseByPath(database.path);
    }
  }
  baseDatabases = BASE_AGENT_IDS.map((agentId) => openCarapaceAgentDatabase({ agentId, env }));
}

function closeFirstBaseHandle(): void {
  const first = baseDatabases[0];
  if (!first || !closeCarapaceAgentDatabaseByPath(first.path)) {
    throw new Error("first base agent database was not open");
  }
}

function evictAfterRefreshingBaseHandles(evictorAgentId: string, env: NodeJS.ProcessEnv): void {
  for (const database of baseDatabases.slice(1)) {
    openCarapaceAgentDatabase({ agentId: database.agentId, env });
  }
  openCarapaceAgentDatabase({ agentId: evictorAgentId, env });
}

beforeAll(() => {
  closeCarapaceAgentDatabasesForTest();
  fixtureStateDir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "carapace-agent-db-cache-")),
  );
  fixtureEnv = { CARAPACE_STATE_DIR: fixtureStateDir };
  restoreBaseCache();
});

beforeEach(() => {
  // Reopen only the base handle evicted by the previous case, then refresh cache order by hits.
  restoreBaseCache();
});

afterAll(() => {
  closeCarapaceAgentDatabasesForTest();
  closeCarapaceStateDatabaseForTest();
  if (fixtureStateDir) {
    fs.rmSync(fixtureStateDir, { force: true, recursive: true });
  }
});

describe("carapace agent database handle cache", () => {
  it("rechecks idle cache capacity after concurrent native admissions", async () => {
    const env = requireFixtureEnv();
    closeFirstBaseHandle();
    const opened = await Promise.all(
      ["async-first", "async-second"].map((agentId) =>
        withCarapaceAgentDatabaseAsync({ agentId, env }, (database) => database),
      ),
    );
    expect(opened.every((database) => database.db.isOpen)).toBe(true);
    expect(listCarapaceAgentDatabasesForTest()).toHaveLength(CARAPACE_AGENT_DB_OPEN_HANDLE_CAP);
  });

  it("retains concurrent admissions through adoption and the transaction's borrower handoff", async () => {
    const env = requireFixtureEnv();
    closeFirstBaseHandle();
    const baseBorrows = baseDatabases
      .slice(1)
      .map(({ agentId }) => borrowCarapaceAgentDatabase({ agentId, env }));
    const entered = createDeferredCore();
    const proceed = createDeferredCore();
    const transferred: ReturnType<typeof borrowCarapaceAgentDatabase>[] = [];
    let operations = 0;
    const admitted = ["adoption-first", "adoption-second"].map((agentId) => {
      const options = { agentId, env };
      return withCarapaceAgentDatabaseAsync(options, async (database) => {
        if (++operations === 2) {
          entered.resolve();
        }
        await (async () => await proceed.promise)();
        expect(database.db.isOpen).toBe(true);
        return runCarapaceAgentWriteTransaction((current) => {
          expect(current.db).toBe(database.db);
          transferred.push(borrowCarapaceAgentDatabase(options));
          return database;
        }, options);
      });
    });
    const finished = Promise.all(admitted);
    try {
      await Promise.race([entered.promise, finished]);
      openCarapaceAgentDatabase({ agentId: "adoption-pressure", env });
      proceed.resolve();
      const databases = await finished;
      expect(databases.every((database) => database.db.isOpen)).toBe(true);
      expect(listCarapaceAgentDatabasesForTest()).toHaveLength(
        CARAPACE_AGENT_DB_OPEN_HANDLE_CAP + 2,
      );
      for (const borrowed of transferred) {
        borrowed.release();
      }
      openCarapaceAgentDatabase({ agentId: "after-adoption", env });
      expect(databases.every((database) => !database.db.isOpen)).toBe(true);
    } finally {
      proceed.resolve();
      await Promise.allSettled(admitted);
      for (const borrowed of [...transferred, ...baseBorrows]) {
        borrowed.release();
      }
    }
  });

  it.each([false, true])(
    "releases a cached operation's borrow after settlement (throws=%s)",
    async (throws) => {
      const env = requireFixtureEnv();
      const target = baseDatabases[0]!;
      const retained = baseDatabases
        .slice(1)
        .map(({ agentId }) => borrowCarapaceAgentDatabase({ agentId, env }));
      const entered = createDeferredCore();
      const proceed = createDeferredCore();
      const result = withCarapaceAgentDatabaseAsync(
        { agentId: target.agentId, env },
        async (database) => {
          entered.resolve();
          await (async () => await proceed.promise)();
          expect(database).toBe(target);
          expect(database.db.isOpen).toBe(true);
          if (throws) {
            throw new Error("synthetic operation failure");
          }
          return database.agentId;
        },
      );
      const settled = throws
        ? expect(result).rejects.toThrow("synthetic operation failure")
        : expect(result).resolves.toBe(target.agentId);
      try {
        await entered.promise;
        openCarapaceAgentDatabase({ agentId: "cached-operation-pressure", env });
        expect(target.db.isOpen).toBe(true);
        proceed.resolve();
        await settled;
        openCarapaceAgentDatabase({ agentId: "after-cached-operation", env });
        expect(target.db.isOpen).toBe(false);
      } finally {
        proceed.resolve();
        await Promise.allSettled([result]);
        for (const borrowed of retained) {
          borrowed.release();
        }
      }
    },
  );

  it("does not invoke an admitted operation after explicit disposal revokes its handle", async () => {
    const env = requireFixtureEnv();
    const target = baseDatabases[0]!;
    const operation = vi.fn();
    const result = withCarapaceAgentDatabaseAsync({ agentId: target.agentId, env }, operation);
    closeCarapaceAgentDatabaseByPath(target.path);
    await expect(result).rejects.toThrow(/closed|revoked/);
    expect(operation).not.toHaveBeenCalled();
  });

  it("keeps only the capped number of open handles", () => {
    const env = requireFixtureEnv();
    const databases = [
      ...baseDatabases,
      openCarapaceAgentDatabase({ agentId: "cap-overflow", env }),
    ];
    const leastRecentlyUsed = databases[0]!;

    expect(databases.filter((database) => database.db.isOpen)).toHaveLength(
      CARAPACE_AGENT_DB_OPEN_HANDLE_CAP,
    );
    expect(isCarapaceAgentDatabaseOpen(leastRecentlyUsed.path)).toBe(false);
    expect(leastRecentlyUsed.db.isOpen).toBe(false);
  });

  it("refreshes cache-hit recency before evicting the true LRU handle", () => {
    const env = requireFixtureEnv();
    const recentlyUsed = baseDatabases[0]!;
    const leastRecentlyUsed = baseDatabases[1]!;

    expect(openCarapaceAgentDatabase({ agentId: recentlyUsed.agentId, env })).toBe(recentlyUsed);
    openCarapaceAgentDatabase({ agentId: "recency-newest", env });

    expect(recentlyUsed.db.isOpen).toBe(true);
    expect(isCarapaceAgentDatabaseOpen(recentlyUsed.path)).toBe(true);
    expect(leastRecentlyUsed.db.isOpen).toBe(false);
    expect(isCarapaceAgentDatabaseOpen(leastRecentlyUsed.path)).toBe(false);
  });

  it("releases an evicted lease in its acquisition store after its environment changes", () => {
    const env = requireFixtureEnv();
    const stateDir = env.CARAPACE_STATE_DIR;
    const nextStateDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-lease-eviction-"));
    const evicted = baseDatabases[0]!;
    const { db: state } = openCarapaceStateDatabase({ env });
    const leases = () =>
      state.prepare("SELECT lease_id FROM agent_database_leases WHERE path = ?").all(evicted.path);
    const acquiredLeases = leases();
    expect(acquiredLeases).toHaveLength(1);
    try {
      env.CARAPACE_STATE_DIR = nextStateDir;
      openCarapaceAgentDatabase({
        agentId: "lease-owner-evictor",
        env: { CARAPACE_STATE_DIR: stateDir },
      });
      expect(evicted.db.isOpen).toBe(false);
      expect(leases()).toEqual([]);
      expect(fs.readdirSync(nextStateDir)).toEqual([]);
    } finally {
      env.CARAPACE_STATE_DIR = stateDir;
      // A failing regression must not leave its original UUID in the shared fixture.
      for (const lease of acquiredLeases) {
        releaseCarapaceAgentDatabaseLease(String(lease.lease_id), { env });
      }
      closeCarapaceStateDatabaseForTest();
      fs.rmSync(nextStateDir, { recursive: true, force: true });
    }
  });

  it("never evicts an LRU handle with an open transaction", () => {
    const env = requireFixtureEnv();
    const transactionOwner = baseDatabases[0]!;
    transactionOwner.db.exec("BEGIN IMMEDIATE");
    try {
      const leastRecentlyUsed = baseDatabases[1]!;
      openCarapaceAgentDatabase({ agentId: "transaction-newest", env });

      expect(transactionOwner.db.isOpen).toBe(true);
      expect(transactionOwner.db.isTransaction).toBe(true);
      expect(isCarapaceAgentDatabaseOpen(transactionOwner.path)).toBe(true);
      expect(leastRecentlyUsed.db.isOpen).toBe(false);
      expect(isCarapaceAgentDatabaseOpen(leastRecentlyUsed.path)).toBe(false);
    } finally {
      transactionOwner.db.exec("ROLLBACK");
    }
  });

  it("pins a completion's exact database until its claim is released", () => {
    const env = requireFixtureEnv();
    const first = baseDatabases[0]!;
    const retained = retainCarapaceAgentDatabaseReadOnly({ agentId: first.agentId, env });
    if (!retained.found) {
      throw new Error("expected the cached database");
    }
    const { claim } = retained;
    try {
      evictAfterRefreshingBaseHandles("completion-pinned", env);
      expect(claim.isCurrent()).toBe(true);
      expect(first.db.isOpen).toBe(true);
      claim.release();
      evictAfterRefreshingBaseHandles("completion-released", env);
      expect(first.db.isOpen).toBe(false);
      expect(claim.isCurrent()).toBe(false);
    } finally {
      claim.release();
    }
  });

  it("retries lease cleanup for a closed retained handle before evicting unrelated agents", () => {
    const env = requireFixtureEnv();
    const first = baseDatabases[0]!;
    const borrowed = borrowCarapaceAgentDatabase({ agentId: first.agentId, env });
    const { db: state } = openCarapaceStateDatabase({ env });
    state.exec(`CREATE TEMP TRIGGER fail_agent_lease_release BEFORE DELETE ON agent_database_leases
      BEGIN SELECT RAISE(ABORT, 'blocked lease release'); END`);
    try {
      expect(() => closeCarapaceAgentDatabaseByPath(first.path)).toThrow("blocked lease release");
      expect(borrowed.db.isOpen).toBe(false);
      state.exec("DROP TRIGGER fail_agent_lease_release");

      evictAfterRefreshingBaseHandles("lease-recovery", env);
      expect(listCarapaceAgentDatabasesForTest()).toHaveLength(CARAPACE_AGENT_DB_OPEN_HANDLE_CAP);
      expect(
        state
          .prepare("SELECT lease_id FROM agent_database_leases WHERE agent_id = ?")
          .all(first.agentId),
      ).toEqual([]);
    } finally {
      state.exec("DROP TRIGGER IF EXISTS fail_agent_lease_release");
      borrowed.release();
      closeCarapaceAgentDatabaseByPath(first.path);
    }
  });

  it("reopens an evicted database without losing durable rows", () => {
    const env = requireFixtureEnv();
    const evicted = baseDatabases[0]!;
    evicted.db
      .prepare(
        "INSERT INTO auth_profile_state (state_key, state_json, updated_at) VALUES (?, ?, ?)",
      )
      .run("cache-eviction", JSON.stringify({ preserved: true }), 42);

    openCarapaceAgentDatabase({ agentId: "durability-evictor", env });
    expect(evicted.db.isOpen).toBe(false);

    const { DatabaseSync } = requireNodeSqlite();
    const divergent = new DatabaseSync(evicted.path);
    try {
      divergent.exec("ALTER TABLE session_nodes DROP COLUMN project_id;");
    } finally {
      divergent.close();
    }

    const reopened = openCarapaceAgentDatabase({ agentId: evicted.agentId, env });
    expect(reopened).not.toBe(evicted);
    expect(
      reopened.db
        .prepare("PRAGMA table_info(session_nodes)")
        .all()
        .some((row) => (row as { name?: unknown }).name === "project_id"),
    ).toBe(true);
    expect(
      reopened.db
        .prepare("SELECT state_json, updated_at FROM auth_profile_state WHERE state_key = ?")
        .get("cache-eviction"),
    ).toEqual({ state_json: JSON.stringify({ preserved: true }), updated_at: 42 });
  });

  it("registers a first open without refreshing registry metadata after eviction", () => {
    const env = requireFixtureEnv();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000);
    try {
      closeFirstBaseHandle();
      const evicted = openCarapaceAgentDatabase({ agentId: "evicted", env });
      expect(
        listCarapaceRegisteredAgentDatabases({ env }).find(
          (entry) => entry.agentId === "evicted" && entry.path === evicted.path,
        ),
      ).toMatchObject({ lastSeenAt: 1_000 });

      nowSpy.mockReturnValue(2_000);
      evictAfterRefreshingBaseHandles("registry-evictor", env);
      expect(evicted.db.isOpen).toBe(false);

      openCarapaceAgentDatabase({ agentId: "evicted", env });
      expect(
        listCarapaceRegisteredAgentDatabases({ env }).find(
          (entry) => entry.agentId === "evicted" && entry.path === evicted.path,
        ),
      ).toMatchObject({ lastSeenAt: 1_000 });
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("validates ownership when an evicted path is requested for another agent", () => {
    const env = requireFixtureEnv();
    closeFirstBaseHandle();
    const evicted = openCarapaceAgentDatabase({ agentId: "worker-a", env });
    evictAfterRefreshingBaseHandles("ownership-evictor", env);
    expect(evicted.db.isOpen).toBe(false);

    expect(() =>
      openCarapaceAgentDatabase({ agentId: "worker-b", env, path: evicted.path }),
    ).toThrow(/belongs to agent worker-a/);
  });

  it("revalidates and registers a database after explicit disposal", () => {
    const env = requireFixtureEnv();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000);
    try {
      const disposed = openCarapaceAgentDatabase({ agentId: "disposed", env });
      expect(
        listCarapaceRegisteredAgentDatabases({ env }).find(
          (entry) => entry.agentId === "disposed" && entry.path === disposed.path,
        ),
      ).toMatchObject({ lastSeenAt: 1_000 });

      expect(disposeCarapaceAgentDatabaseByPath(disposed.path, { env })).toBe(true);
      expect(
        listCarapaceRegisteredAgentDatabases({ env }).some(
          (entry) => entry.agentId === "disposed" && entry.path === disposed.path,
        ),
      ).toBe(false);

      nowSpy.mockReturnValue(2_000);
      openCarapaceAgentDatabase({ agentId: "disposed", env, path: disposed.path });
      expect(
        listCarapaceRegisteredAgentDatabases({ env }).find(
          (entry) => entry.agentId === "disposed" && entry.path === disposed.path,
        ),
      ).toMatchObject({ lastSeenAt: 2_000 });
    } finally {
      nowSpy.mockRestore();
    }
  });
});

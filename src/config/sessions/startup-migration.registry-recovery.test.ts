import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../../test/helpers/temp-dir.js";
import * as sessionDirs from "../../agents/session-dirs.js";
import * as nodeSqlite from "../../infra/node-sqlite.js";
import {
  beginAgentDeletionJournal,
  completeAgentDeletionJournalInDatabase,
} from "../../state/agent-deletion-journal.js";
import { invalidateRegisteredAgentDatabasesMemo } from "../../state/carapace-agent-db-registry-listing.js";
import { unregisterCarapaceAgentDatabase } from "../../state/carapace-agent-db-registry.js";
import {
  closeCarapaceAgentDatabasesForTest,
  getCarapaceAgentDatabaseIfOpen,
  isCarapaceAgentDatabaseOpen,
  listCarapaceRegisteredAgentDatabases,
  openCarapaceAgentDatabase,
  type CarapaceAgentDatabaseOptions,
} from "../../state/carapace-agent-db.js";
import {
  closeCarapaceStateDatabaseForTest,
  repairCarapaceStateDatabaseSchemaIfNeeded,
  runCarapaceStateWriteTransaction,
} from "../../state/carapace-state-db.js";
import { withEnvAsync } from "../../test-utils/env.js";
import type { CarapaceConfig } from "../types.carapace.js";
import { loadCombinedSessionStoreForGatewayCore } from "./combined-store-gateway.js";
import { replaceSessionEntry } from "./session-accessor.js";
import {
  isCanonicalSqliteSessionMainKeyCurrent,
  setCanonicalSqliteSessionMainKey,
} from "./session-canonical-key.js";
import { resolveSqliteTargetFromSessionStorePath } from "./session-sqlite-target.js";
import { reconcileSessionTranscriptIndexes } from "./session-transcript-reconcile.js";
import { runSessionStartupMigration } from "./startup-migration.js";
import { resolveAllAgentSessionStoreTargetsSync } from "./targets.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);

afterEach(() => {
  closeCarapaceAgentDatabasesForTest();
  closeCarapaceStateDatabaseForTest();
});

it.each(["cold", "preexisting"] as const)(
  "preserves the %s database lifetime for maintenance without a runtime handoff",
  async (lifetime) => {
    const stateDir = fs.realpathSync.native(tempDirs.make("carapace-startup-handle-lifetime-"));
    const env = { ...process.env, CARAPACE_STATE_DIR: stateDir };
    const options = { agentId: "main", env };
    const initial = openCarapaceAgentDatabase(options);
    setCanonicalSqliteSessionMainKey(initial, "previous");
    if (lifetime === "cold") {
      closeCarapaceAgentDatabasesForTest();
    }

    await runSessionStartupMigration({
      cfg: { agents: { entries: { main: {} } } },
      env,
      log: { info: vi.fn(), warn: vi.fn() },
    });

    expect(isCanonicalSqliteSessionMainKeyCurrent(options, undefined)).toBe(true);
    expect(isCarapaceAgentDatabaseOpen(initial.path)).toBe(lifetime === "preexisting");
    if (lifetime === "preexisting") {
      expect(getCarapaceAgentDatabaseIfOpen(options)).toBe(initial);
    }
  },
);

it("does not create a missing configured agent database during startup maintenance", async () => {
  const root = fs.realpathSync.native(tempDirs.make("carapace-startup-missing-agent-db-"));
  const stateDir = path.join(root, "state");
  const storePath = path.join(stateDir, "agents", "idle", "sessions", "sessions.json");
  const env = { ...process.env, CARAPACE_STATE_DIR: stateDir };
  const cfg: CarapaceConfig = {
    agents: { entries: { idle: { default: true } } },
    session: { store: path.join(stateDir, "agents", "{agentId}", "sessions", "sessions.json") },
  };
  const sqlitePath = resolveSqliteTargetFromSessionStorePath(storePath, {
    agentId: "idle",
    env,
  }).path;
  const migrateManagedWorktreeCanonicalWorkspaces = vi.fn(async () => 0);

  await runSessionStartupMigration({
    cfg,
    env,
    log: { info: vi.fn(), warn: vi.fn() },
    deps: {
      migrateLegacyMainSessionKeys: vi.fn(async () => ({
        armed: false,
        changes: [],
        complete: false,
        ledgerComplete: false,
        legacyAgentId: "main",
        mainKey: "main",
        outcomes: [{ kind: "not-armed" as const }],
        warnings: [],
      })),
      migrateManagedWorktreeCanonicalWorkspaces,
      resolveAllAgentSessionStoreTargetsSync: () => [{ agentId: "idle", storePath }],
    },
  });

  expect(fs.existsSync(sqlitePath)).toBe(false);
  expect(migrateManagedWorktreeCanonicalWorkspaces).not.toHaveBeenCalled();
});

it.each([false, true])(
  "reconciles surviving stores while retained deleted stores stay fenced (cleanup completed: %s)",
  async (cleanupCompleted) => {
    const stateDir = fs.realpathSync.native(tempDirs.make("carapace-startup-deleted-agent-"));
    const env = { ...process.env, CARAPACE_STATE_DIR: stateDir };
    const sharedPath = path.join(stateDir, "shared.sqlite");
    const cfg: CarapaceConfig = {
      agents: { ownership: "explicit", entries: { alpha: {} } },
      session: { store: sharedPath },
    };
    const survivorOptions = { agentId: "alpha", env, path: sharedPath };
    const survivor = openCarapaceAgentDatabase(survivorOptions);
    const deletedOptions = { agentId: "ops", env };
    const deleted = openCarapaceAgentDatabase(deletedOptions);
    for (const agentId of ["alpha", "ops"]) {
      await replaceSessionEntry(
        { agentId, env, storePath: sharedPath, sessionKey: `agent:${agentId}:shared` },
        { sessionId: `${agentId}-shared`, updatedAt: 1 },
      );
    }
    setCanonicalSqliteSessionMainKey(survivor, "previous");
    setCanonicalSqliteSessionMainKey(deleted, "previous");
    closeCarapaceAgentDatabasesForTest();
    const deletion = beginAgentDeletionJournal(
      {
        agentId: "ops",
        operationId: randomUUID(),
        agentDir: path.dirname(deleted.path),
        sessionsDir: path.join(stateDir, "agents", "ops", "sessions"),
        workspaceDir: path.join(stateDir, "workspace-ops"),
        deleteFiles: false,
      },
      { env },
    );
    if (cleanupCompleted) {
      runCarapaceStateWriteTransaction(
        (database) => completeAgentDeletionJournalInDatabase(database, "ops", deletion.operationId),
        { env },
      );
    }
    expect(resolveAllAgentSessionStoreTargetsSync(cfg, { env })).toContainEqual(
      expect.objectContaining({ agentId: "ops" }),
    );
    const log = { info: vi.fn(), warn: vi.fn() };
    const handoffDatabase = vi.fn(async (options: CarapaceAgentDatabaseOptions) => {
      await reconcileSessionTranscriptIndexes(options);
    });

    await runSessionStartupMigration({ cfg, env, log, handoffDatabase });

    expect(handoffDatabase).toHaveBeenCalledExactlyOnceWith(survivorOptions);
    expect(isCanonicalSqliteSessionMainKeyCurrent(survivorOptions, undefined)).toBe(true);
    expect(isCanonicalSqliteSessionMainKeyCurrent(deletedOptions, "previous")).toBe(true);
    expect(isCarapaceAgentDatabaseOpen(deleted.path)).toBe(false);
    expect(() => openCarapaceAgentDatabase(deletedOptions)).toThrow("agent ops is deleted");
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith(
      expect.stringContaining(cleanupCompleted ? "cleanup complete" : "cleanup pending"),
    );
  },
);

it("re-registers durable lineage children before configured-only runtime reads", async () => {
  const root = fs.realpathSync.native(tempDirs.make("carapace-startup-registry-recovery-"));
  const stateDir = path.join(root, "state");
  await withEnvAsync({ CARAPACE_STATE_DIR: stateDir }, async () => {
    const env = { ...process.env };
    const storeTemplate = path.join(stateDir, "agents", "{agentId}", "sessions", "sessions.json");
    const cfg: CarapaceConfig = {
      agents: { entries: { ops: { default: true } } },
      session: { store: storeTemplate },
    };
    const mainKey = "agent:ops:main";
    const childKey = "agent:codex:subagent:upgrade-child";
    const storePathFor = (agentId: string) => storeTemplate.replace("{agentId}", agentId);

    await replaceSessionEntry(
      { agentId: "ops", env, sessionKey: mainKey, storePath: storePathFor("ops") },
      { sessionId: "session-ops", updatedAt: 20 },
    );
    await replaceSessionEntry(
      { agentId: "codex", env, sessionKey: childKey, storePath: storePathFor("codex") },
      { sessionId: "session-codex", spawnedBy: mainKey, updatedAt: 30 },
    );
    await replaceSessionEntry(
      {
        agentId: "local",
        env,
        sessionKey: "agent:local:main",
        storePath: storePathFor("local"),
      },
      { sessionId: "session-local", updatedAt: 10 },
    );

    const childDatabasePath = resolveSqliteTargetFromSessionStorePath(storePathFor("codex"), {
      agentId: "codex",
      env,
    }).path;
    closeCarapaceAgentDatabasesForTest();
    unregisterCarapaceAgentDatabase({ agentId: "codex", env, path: childDatabasePath });

    expect(fs.existsSync(childDatabasePath)).toBe(true);
    expect(
      listCarapaceRegisteredAgentDatabases({ env }).some(
        (entry) => entry.agentId === "codex" && entry.path === childDatabasePath,
      ),
    ).toBe(false);

    const migrateManagedWorktreeCanonicalWorkspaces = vi.fn(async () => 0);
    await runSessionStartupMigration({
      cfg,
      env,
      log: { info: vi.fn(), warn: vi.fn() },
      deps: {
        migrateManagedWorktreeCanonicalWorkspaces,
        migrateLegacyMainSessionKeys: vi.fn(async () => ({
          armed: false,
          changes: [],
          complete: false,
          ledgerComplete: false,
          legacyAgentId: "main",
          mainKey: "main",
          outcomes: [{ kind: "not-armed" as const }],
          warnings: [],
        })),
      },
    });
    expect(migrateManagedWorktreeCanonicalWorkspaces).toHaveBeenCalled();

    expect(listCarapaceRegisteredAgentDatabases({ env })).toContainEqual(
      expect.objectContaining({ agentId: "codex", path: childDatabasePath }),
    );

    const enumerateAgentDirs = vi.spyOn(sessionDirs, "resolveAgentSessionDirsFromAgentsDirSync");
    try {
      const store = loadCombinedSessionStoreForGatewayCore(cfg, {
        configuredAgentsOnly: true,
      }).store;
      expect(store[mainKey]?.sessionId).toBe("session-ops");
      expect(store[childKey]?.sessionId).toBe("session-codex");
      expect(store["agent:local:main"]).toBeUndefined();
      expect(enumerateAgentDirs).not.toHaveBeenCalled();
    } finally {
      enumerateAgentDirs.mockRestore();
    }
  });
});

it("keeps copied state directories self-contained for combined gateway reads", async () => {
  const root = fs.realpathSync.native(tempDirs.make("carapace-copied-state-registry-"));
  const sourceStateDir = path.join(root, "source");
  fs.mkdirSync(sourceStateDir);
  const canonicalSourceStateDir = fs.realpathSync.native(sourceStateDir);
  const copiedStateDir = path.join(root, "copy");
  const cfg: CarapaceConfig = {
    agents: { entries: { main: { default: true } } },
  };
  const sessionKey = "agent:main:copied-state";

  await withEnvAsync({ CARAPACE_STATE_DIR: canonicalSourceStateDir }, async () => {
    const env = { ...process.env };
    await replaceSessionEntry(
      { agentId: "main", env, sessionKey },
      { sessionId: "copied-session", updatedAt: 1 },
    );
    closeCarapaceAgentDatabasesForTest();
    closeCarapaceStateDatabaseForTest();
    invalidateRegisteredAgentDatabasesMemo({ env });
  });

  fs.cpSync(canonicalSourceStateDir, copiedStateDir, { recursive: true });
  const canonicalCopiedStateDir = fs.realpathSync.native(copiedStateDir);
  await withEnvAsync({ CARAPACE_STATE_DIR: canonicalCopiedStateDir }, async () => {
    const env = { ...process.env };
    expect(repairCarapaceStateDatabaseSchemaIfNeeded({ env }).warnings).toEqual([]);
    const combined = loadCombinedSessionStoreForGatewayCore(cfg, {
      configuredAgentsOnly: true,
    });

    expect(combined.store[sessionKey]?.sessionId).toBe("copied-session");
    expect(Object.keys(combined.store).filter((key) => key === sessionKey)).toHaveLength(1);
    closeCarapaceAgentDatabasesForTest();
    closeCarapaceStateDatabaseForTest();
    invalidateRegisteredAgentDatabasesMemo({ env });
  });
});

it.each(["registry", "main-key"] as const)(
  "keeps the event loop responsive while repairing a cold %s startup contract",
  async (repair) => {
    const stateDir = fs.realpathSync.native(tempDirs.make("carapace-startup-admission-"));
    const env = { ...process.env, CARAPACE_STATE_DIR: stateDir };
    const options = { agentId: "main", env };
    const cfg: CarapaceConfig = {
      agents: { entries: { main: {} } },
      session: {},
    };
    const initial = openCarapaceAgentDatabase(options);
    setCanonicalSqliteSessionMainKey(initial, repair === "main-key" ? "previous" : "main");
    closeCarapaceAgentDatabasesForTest();
    if (repair === "registry") {
      unregisterCarapaceAgentDatabase({ ...options, path: initial.path });
    }
    const originalOpen = nodeSqlite.openNodeSqliteDatabase;
    let yielded = false;
    let maintenanceSawProgress = false;
    let maintenanceSawSelectedKey = false;
    let tick: ReturnType<typeof setImmediate> | undefined;
    const open = vi
      .spyOn(nodeSqlite, "openNodeSqliteDatabase")
      .mockImplementation((location, behavior) => {
        const database = originalOpen(location, behavior);
        if (location === initial.path && behavior?.readOnly !== true) {
          // Earlier async setup cannot satisfy this admission-phase progress check.
          tick = setImmediate(() => {
            yielded = true;
            cfg.session!.mainKey = "later";
          });
        }
        return database;
      });
    const log = { info: vi.fn(), warn: vi.fn() };
    try {
      await runSessionStartupMigration({
        cfg,
        env,
        log,
        deps: {
          migrateManagedWorktreeCanonicalWorkspaces: async () => {
            maintenanceSawProgress = yielded;
            maintenanceSawSelectedKey = isCanonicalSqliteSessionMainKeyCurrent(options, undefined);
            return 0;
          },
        },
      });
      expect(log.warn).not.toHaveBeenCalled();
      expect(maintenanceSawProgress).toBe(true);
      expect(maintenanceSawSelectedKey).toBe(true);
      expect(listCarapaceRegisteredAgentDatabases({ env })).toContainEqual(
        expect.objectContaining({ agentId: "main", path: initial.path }),
      );
      expect(isCarapaceAgentDatabaseOpen(initial.path)).toBe(false);
    } finally {
      if (tick) {
        clearImmediate(tick);
      }
      open.mockRestore();
    }
  },
);

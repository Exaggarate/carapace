import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import packageJson from "../../package.json" with { type: "json" };
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { requireNodeSqlite } from "../infra/node-sqlite.js";
import { collectSqliteSchemaIssues } from "../infra/sqlite-schema-contract.js";
import { runSqliteImmediateTransactionSync } from "../infra/sqlite-transaction.js";
import { createUpdateRun } from "../infra/update-run-ledger.js";
import { CarapaceAgentDatabaseMediaMigrationRequiredError } from "./carapace-agent-db-migration-required.js";
import {
  closeCarapaceAgentDatabasesForTest,
  CARAPACE_AGENT_SCHEMA_VERSION,
  openCarapaceAgentDatabase,
} from "./carapace-agent-db.js";
import {
  assertCarapaceDatabasesReady,
  preflightCarapaceStateDatabasePath,
  preflightCarapaceDatabaseSchemas,
} from "./carapace-database-preflight.js";
import { repairAuditEventsSchema } from "./carapace-state-db-audit-migration.js";
import { CARAPACE_STATE_SCHEMA_VERSION } from "./carapace-state-db-contract.js";
import { CarapaceStateDatabaseSchemaMigrationRequiredError } from "./carapace-state-db-schema-migration-required.js";
import {
  closeCarapaceStateDatabaseForTest,
  openCarapaceStateDatabase,
} from "./carapace-state-db.js";
import { resolveCarapaceStateSqlitePath } from "./carapace-state-db.paths.js";
import { CARAPACE_STATE_SCHEMA_SQL } from "./carapace-state-schema.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);

afterEach(() => {
  closeCarapaceAgentDatabasesForTest();
  closeCarapaceStateDatabaseForTest();
});

describe("Carapace database schema preflight", () => {
  function snapshotSourceFamily(databasePath: string) {
    const paths = [databasePath, `${databasePath}-wal`, `${databasePath}-shm`].filter(
      fs.existsSync,
    );
    return {
      entries: fs.readdirSync(path.dirname(databasePath)).toSorted(),
      files: paths.map((pathname) => {
        const stat = fs.statSync(pathname, { bigint: true });
        return {
          pathname,
          bytes: fs.readFileSync(pathname),
          birthtimeNs: stat.birthtimeNs,
          ctimeNs: stat.ctimeNs,
          dev: stat.dev,
          ino: stat.ino,
          mtimeNs: stat.mtimeNs,
          size: stat.size,
        };
      }),
    };
  }

  function createExplicitStateDatabase(schemaSql = CARAPACE_STATE_SCHEMA_SQL): string {
    const stateDir = tempDirs.make("carapace-explicit-state-preflight-");
    const databasePath = path.join(stateDir, "candidate.sqlite");
    const { DatabaseSync } = requireNodeSqlite();
    const database = new DatabaseSync(databasePath);
    try {
      // Match production bootstrap: one durable commit, not one per schema object.
      runSqliteImmediateTransactionSync(database, () => {
        database.exec(`${schemaSql}; PRAGMA user_version = ${CARAPACE_STATE_SCHEMA_VERSION};`);
        database
          .prepare(
            `INSERT INTO schema_meta (
               meta_key, role, schema_version, agent_id, app_version, created_at, updated_at
             ) VALUES ('primary', 'global', ?, NULL, NULL, 1, 1)`,
          )
          .run(CARAPACE_STATE_SCHEMA_VERSION);
      });
    } finally {
      database.close();
    }
    return databasePath;
  }

  function sourceManifest(stateDir: string) {
    // Coordinator tmp/ files are lifecycle scratch; persistent artifacts must not change.
    return fs
      .readdirSync(stateDir, { recursive: true, encoding: "utf8" })
      .filter((entry) => !entry.startsWith(`tmp${path.sep}`))
      .filter((entry) => fs.statSync(path.join(stateDir, entry)).isFile())
      .toSorted()
      .map((entry) => [
        entry,
        createHash("sha256")
          .update(fs.readFileSync(path.join(stateDir, entry)))
          .digest("hex"),
      ]);
  }

  function createReleasedStateDatabase() {
    const stateDir = tempDirs.make("carapace-startup-database-admission-");
    const env = { CARAPACE_STATE_DIR: stateDir };
    const statePath = resolveCarapaceStateSqlitePath(env);
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(
      statePath,
      gunzipSync(
        fs.readFileSync(
          new URL(
            "../../test/fixtures/sqlite/carapace-state-v2026.7.1-2.sqlite.gz",
            import.meta.url,
          ),
        ),
      ),
    );
    fs.writeFileSync(path.join(stateDir, "carapace.json"), "{}\n");
    return { env, stateDir, statePath };
  }

  it("refuses released legacy audit state before changing any persistent artifact", async () => {
    const { env, stateDir, statePath } = createReleasedStateDatabase();
    const before = sourceManifest(stateDir);
    await expect(
      assertCarapaceDatabasesReady({ env, operation: "gateway-startup", config: {} }),
    ).rejects.toBeInstanceOf(CarapaceStateDatabaseSchemaMigrationRequiredError);
    expect(sourceManifest(stateDir)).toEqual(before);
    await expect(preflightCarapaceStateDatabasePath(statePath)).resolves.toMatchObject({
      foundVersion: 1,
    });
  });

  it.each(["configured", "registered"] as const)(
    "refuses a %s legacy agent database without mutating its WAL or creating stores",
    async (layout) => {
      const stateDir = tempDirs.make("carapace-agent-startup-admission-");
      const env = { CARAPACE_STATE_DIR: stateDir };
      const agentPath =
        layout === "configured"
          ? path.join(stateDir, "custom", "sessions.sqlite")
          : path.join(stateDir, "agents", "retired", "agent", "carapace-agent.sqlite");
      const agentId = layout === "configured" ? "main" : "retired";
      openCarapaceAgentDatabase({ agentId, path: agentPath, env });
      closeCarapaceAgentDatabasesForTest();
      closeCarapaceStateDatabaseForTest();
      const { DatabaseSync } = requireNodeSqlite();
      const writer = new DatabaseSync(agentPath);
      try {
        writer.exec(
          "PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0; PRAGMA user_version = 15; UPDATE schema_meta SET schema_version = 15;",
        );
        const config =
          layout === "configured"
            ? { session: { store: path.join(stateDir, "custom", "sessions.json") } }
            : {};
        const before = sourceManifest(stateDir);
        await expect(
          assertCarapaceDatabasesReady({ env, operation: "gateway-startup", config }),
        ).rejects.toBeInstanceOf(CarapaceAgentDatabaseMediaMigrationRequiredError);
        expect(sourceManifest(stateDir)).toEqual(before);
      } finally {
        writer.close();
      }
    },
  );

  it("rejects a canonical configured agent path owned by another agent before writes", async () => {
    const root = tempDirs.make("carapace-configured-agent-owner-");
    const env = { CARAPACE_STATE_DIR: path.join(root, "active") };
    const agentDir = path.join(root, "external", "agents", "alpha");
    const agentPath = path.join(agentDir, "agent", "carapace-agent.sqlite");
    const store = path.join(agentDir, "sessions", "sessions.json");
    openCarapaceAgentDatabase({
      agentId: "beta",
      path: agentPath,
      env: { CARAPACE_STATE_DIR: path.join(root, "donor") },
    });
    closeCarapaceAgentDatabasesForTest();
    closeCarapaceStateDatabaseForTest();
    const before = sourceManifest(root);
    await expect(
      assertCarapaceDatabasesReady({
        env,
        operation: "gateway-startup",
        config: { session: { store } },
      }),
    ).rejects.toThrow("belongs to agent beta; requested agent alpha");
    expect(sourceManifest(root)).toEqual(before);
  });

  it("admits supported forward state migration after the Doctor-owned audit repair", async () => {
    const { env, stateDir, statePath } = createReleasedStateDatabase();
    const { DatabaseSync } = requireNodeSqlite();
    const database = new DatabaseSync(statePath);
    try {
      expect(repairAuditEventsSchema(database)).toBe(true);
    } finally {
      database.close();
    }
    const before = sourceManifest(stateDir);
    await expect(
      assertCarapaceDatabasesReady({ env, operation: "gateway-startup", config: {} }),
    ).resolves.toBeUndefined();
    expect(sourceManifest(stateDir)).toEqual(before);
    const migrated = openCarapaceStateDatabase({ env });
    expect(migrated.db.prepare("PRAGMA user_version").get()).toEqual({
      user_version: CARAPACE_STATE_SCHEMA_VERSION,
    });
  });

  it("reports an exact current schema for one explicit copied database", async () => {
    const stateDir = tempDirs.make("carapace-runtime-state-preflight-");
    const env = { CARAPACE_STATE_DIR: stateDir };
    const opened = openCarapaceStateDatabase({ env });
    const databasePath = opened.path;
    expect(
      opened.db
        .prepare(
          "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'execution_identity_contexts'",
        )
        .get(),
    ).toBeUndefined();
    closeCarapaceStateDatabaseForTest();

    await expect(preflightCarapaceStateDatabasePath(databasePath)).resolves.toEqual({
      schema: "carapace.state-schema-preflight.v1",
      databasePath,
      targetVersion: CARAPACE_STATE_SCHEMA_VERSION,
      foundVersion: CARAPACE_STATE_SCHEMA_VERSION,
      ownership: null,
      issues: [],
      status: "exact",
      requiresWrite: false,
    });
  });

  it("treats a supported persistent column definition as exact", async () => {
    const databasePath = createExplicitStateDatabase(
      CARAPACE_STATE_SCHEMA_SQL.replace(
        "  kind TEXT NOT NULL,\n  sensitivity TEXT NOT NULL,",
        "  kind TEXT NOT NULL DEFAULT 'followup',\n  sensitivity TEXT NOT NULL,",
      ),
    );

    await expect(preflightCarapaceStateDatabasePath(databasePath)).resolves.toEqual({
      schema: "carapace.state-schema-preflight.v1",
      databasePath,
      targetVersion: CARAPACE_STATE_SCHEMA_VERSION,
      foundVersion: CARAPACE_STATE_SCHEMA_VERSION,
      ownership: null,
      status: "exact",
      requiresWrite: false,
      issues: [],
    });
  });

  it("accepts a copied current schema with a future bare nullable column without touching it", async () => {
    const sourcePath = createExplicitStateDatabase();
    const databasePath = path.join(
      tempDirs.make("carapace-copied-state-preflight-"),
      "candidate.sqlite",
    );
    fs.copyFileSync(sourcePath, databasePath);
    const { DatabaseSync } = requireNodeSqlite();
    const database = new DatabaseSync(databasePath);
    try {
      database.exec("ALTER TABLE worktrees ADD COLUMN future_note TEXT;");
    } finally {
      database.close();
    }
    const before = snapshotSourceFamily(databasePath);

    await expect(preflightCarapaceStateDatabasePath(databasePath)).resolves.toEqual({
      schema: "carapace.state-schema-preflight.v1",
      databasePath,
      targetVersion: CARAPACE_STATE_SCHEMA_VERSION,
      foundVersion: CARAPACE_STATE_SCHEMA_VERSION,
      ownership: null,
      status: "exact",
      requiresWrite: false,
      issues: [],
    });
    expect(snapshotSourceFamily(databasePath)).toEqual(before);
  });

  it("classifies a drifted canonical named index as startup-repairable", async () => {
    const databasePath = createExplicitStateDatabase();
    const { DatabaseSync } = requireNodeSqlite();
    const database = new DatabaseSync(databasePath);
    try {
      database.exec(`
        DROP INDEX idx_task_runs_status;
        CREATE INDEX idx_task_runs_status ON task_runs(task_id);
      `);
    } finally {
      database.close();
    }

    await expect(preflightCarapaceStateDatabasePath(databasePath)).resolves.toEqual({
      schema: "carapace.state-schema-preflight.v1",
      databasePath,
      targetVersion: CARAPACE_STATE_SCHEMA_VERSION,
      foundVersion: CARAPACE_STATE_SCHEMA_VERSION,
      ownership: null,
      status: "startup-repairable",
      requiresWrite: true,
      issues: [
        {
          code: "missing-or-drifted-index",
          message: "missing or drifted index idx_task_runs_status",
          objectName: "idx_task_runs_status",
        },
      ],
    });
  });

  it.each([false, true])(
    "admits legacy additive columns without writes, rejecting genuine drift=%s",
    async (drift) => {
      const initialPath = createExplicitStateDatabase();
      const stateDir = path.dirname(initialPath);
      const databasePath = path.join(stateDir, "state", "carapace.sqlite");
      fs.mkdirSync(path.dirname(databasePath));
      fs.renameSync(initialPath, databasePath);
      const database = new (requireNodeSqlite().DatabaseSync)(databasePath);
      database.exec(
        "ALTER TABLE task_runs DROP COLUMN tool_use_count; ALTER TABLE task_runs DROP COLUMN last_tool_name; ALTER TABLE apns_registrations DROP COLUMN relay_origin;",
      );
      if (drift) {
        database.exec("ALTER TABLE task_runs ADD COLUMN unrecognized INTEGER NOT NULL DEFAULT 0");
      }
      database.close();
      const before = snapshotSourceFamily(databasePath);
      expect(await preflightCarapaceStateDatabasePath(databasePath)).toMatchObject({
        foundVersion: CARAPACE_STATE_SCHEMA_VERSION,
        status: drift ? "incompatible" : "startup-repairable",
      });
      const admission = assertCarapaceDatabasesReady({
        env: { CARAPACE_STATE_DIR: stateDir },
        operation: "gateway-startup",
        config: {},
      });
      if (drift) {
        await expect(admission).rejects.toThrow("requires repair");
      } else {
        await expect(admission).resolves.toBeUndefined();
      }
      expect(snapshotSourceFamily(databasePath)).toEqual(before);
    },
  );

  it("classifies the same-version run-end cleanup column as startup-repairable without touching the source", async () => {
    const sourcePath = createExplicitStateDatabase(
      CARAPACE_STATE_SCHEMA_SQL.replace(
        "  removed_at INTEGER,\n  run_end_cleanup_json TEXT\n",
        "  removed_at INTEGER\n",
      ),
    );
    const snapshotPath = path.join(
      tempDirs.make("carapace-consolidated-state-preflight-"),
      "candidate.sqlite",
    );
    const sqlite = requireNodeSqlite();
    const writer = new sqlite.DatabaseSync(sourcePath);
    try {
      writer.exec("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0;");
      writer
        .prepare(
          "INSERT INTO config_machine_state (state_key, value_json, updated_at_ms) VALUES ('preflight.probe', '{}', 1)",
        )
        .run();
      await sqlite.backup(writer, snapshotPath);
      writer
        .prepare(
          "INSERT INTO config_machine_state (state_key, value_json, updated_at_ms) VALUES ('preflight.after-backup', '{}', 2)",
        )
        .run();
      expect(fs.existsSync(`${sourcePath}-wal`)).toBe(true);
      expect(fs.existsSync(`${sourcePath}-shm`)).toBe(true);
      for (const suffix of ["-wal", "-shm", "-journal"]) {
        expect(fs.existsSync(`${snapshotPath}${suffix}`)).toBe(false);
      }
      const before = snapshotSourceFamily(sourcePath);

      const result = await preflightCarapaceStateDatabasePath(snapshotPath);

      expect(result).toMatchObject({
        foundVersion: CARAPACE_STATE_SCHEMA_VERSION,
        status: "startup-repairable",
        requiresWrite: true,
        issues: [
          {
            code: "missing-column",
            objectName: "worktrees.run_end_cleanup_json",
          },
        ],
      });
      expect(snapshotSourceFamily(sourcePath)).toEqual(before);
    } finally {
      writer.close();
    }
  });

  it("accepts first-use session group columns without requiring a startup write", async () => {
    const databasePath = createExplicitStateDatabase(
      CARAPACE_STATE_SCHEMA_SQL.replace(
        "  created_at INTEGER NOT NULL,\n  cwd TEXT,\n  worktree INTEGER\n",
        "  created_at INTEGER NOT NULL\n",
      ),
    );

    await expect(preflightCarapaceStateDatabasePath(databasePath)).resolves.toMatchObject({
      status: "exact",
      requiresWrite: false,
      issues: [],
    });
  });

  it("rejects an explicit preflight path with sidecars without touching it", async () => {
    const databasePath = createExplicitStateDatabase();
    const sqlite = requireNodeSqlite();
    const writer = new sqlite.DatabaseSync(databasePath);
    try {
      writer.exec("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0;");
      writer
        .prepare(
          "INSERT INTO config_machine_state (state_key, value_json, updated_at_ms) VALUES ('preflight.live', '{}', 1)",
        )
        .run();
      const before = snapshotSourceFamily(databasePath);

      await expect(preflightCarapaceStateDatabasePath(databasePath)).resolves.toMatchObject({
        foundVersion: null,
        status: "indeterminate",
        requiresWrite: false,
        reason: expect.stringMatching(/consolidated snapshot.*sidecars.*online backup/iu),
      });
      expect(snapshotSourceFamily(databasePath)).toEqual(before);
    } finally {
      writer.close();
    }
  });

  it("reports an explicit unreadable path as indeterminate", async () => {
    const stateDir = tempDirs.make("carapace-explicit-unreadable-preflight-");
    const databasePath = path.join(stateDir, "not-sqlite.db");
    fs.writeFileSync(databasePath, "not a sqlite database");

    await expect(preflightCarapaceStateDatabasePath(databasePath)).resolves.toMatchObject({
      databasePath,
      foundVersion: null,
      status: "indeterminate",
      requiresWrite: false,
      reason: expect.stringMatching(/database|file/iu),
    });
  });

  it("reports invalid negative schema metadata as indeterminate", async () => {
    const databasePath = createExplicitStateDatabase();
    const { DatabaseSync } = requireNodeSqlite();
    const database = new DatabaseSync(databasePath);
    try {
      database.exec("PRAGMA user_version = -1;");
    } finally {
      database.close();
    }

    await expect(preflightCarapaceStateDatabasePath(databasePath)).resolves.toMatchObject({
      foundVersion: -1,
      status: "indeterminate",
      reason: expect.stringContaining("invalid schema version metadata"),
    });
  });

  it("treats a current-v6 additive column as incompatible with the older v6 shape", () => {
    const { DatabaseSync } = requireNodeSqlite();
    const database = new DatabaseSync(":memory:");
    try {
      database.exec(CARAPACE_STATE_SCHEMA_SQL);
      const olderV6Schema = CARAPACE_STATE_SCHEMA_SQL.replace(
        "  removed_at INTEGER,\n  run_end_cleanup_json TEXT\n",
        "  removed_at INTEGER\n",
      );

      expect(collectSqliteSchemaIssues(database, olderV6Schema)).toContainEqual(
        expect.objectContaining({
          code: "unexpected-column",
          objectName: "worktrees.run_end_cleanup_json",
        }),
      );
    } finally {
      database.close();
    }
  });

  it("keeps package schema support metadata aligned", () => {
    expect(packageJson.carapace.schemaVersions).toEqual({
      state: CARAPACE_STATE_SCHEMA_VERSION,
      agent: CARAPACE_AGENT_SCHEMA_VERSION,
    });
  });

  it("accepts a supported state schema", async () => {
    const stateDir = tempDirs.make("carapace-database-preflight-supported-");
    const env = { CARAPACE_STATE_DIR: stateDir };
    openCarapaceStateDatabase({ env });
    closeCarapaceStateDatabaseForTest();

    expect(
      await preflightCarapaceDatabaseSchemas({
        env,
        verifyCurrentSchemaShape: true,
        supportedVersions: {
          state: CARAPACE_STATE_SCHEMA_VERSION,
          agent: CARAPACE_AGENT_SCHEMA_VERSION,
        },
      }),
    ).toEqual({ incompatible: [], indeterminate: [] });
    await expect(
      assertCarapaceDatabasesReady({ env, operation: "gateway-restart" }),
    ).resolves.toBeUndefined();
  });

  it.each([false, true])(
    "recognizes deferred content and still checks its shape (damaged: %s)",
    async (damaged) => {
      const stateDir = tempDirs.make("carapace-preflight-deferred-schema-");
      const env = { CARAPACE_STATE_DIR: stateDir };
      const opened = openCarapaceStateDatabase({ env });
      const run = createUpdateRun({ trigger: "cli", before: { version: "2026.9.2" } }, { env });
      const statePath = opened.path;
      closeCarapaceStateDatabaseForTest();
      const { DatabaseSync } = requireNodeSqlite();
      const database = new DatabaseSync(statePath);
      try {
        database.exec(
          `PRAGMA user_version = ${CARAPACE_STATE_SCHEMA_VERSION - 1}; UPDATE schema_meta SET schema_version = ${CARAPACE_STATE_SCHEMA_VERSION - 1};`,
        );
        database
          .prepare(
            "INSERT INTO config_machine_state (state_key, value_json, updated_at_ms) VALUES (?, ?, ?)",
          )
          .run("state.schema.contentVersion", String(CARAPACE_STATE_SCHEMA_VERSION), Date.now());
        if (damaged) {
          database.exec(
            "ALTER TABLE worktrees DROP COLUMN run_end_cleanup_json; ALTER TABLE worktrees ADD COLUMN run_end_cleanup_json INTEGER;",
          );
        }
      } finally {
        database.close();
      }
      const before = snapshotSourceFamily(statePath);
      const result = await preflightCarapaceDatabaseSchemas({
        env,
        verifyCurrentSchemaShape: true,
        supportedVersions: {
          state: CARAPACE_STATE_SCHEMA_VERSION,
          agent: CARAPACE_AGENT_SCHEMA_VERSION,
        },
      });
      expect(result.pendingMigrations).toBeUndefined();
      expect(result.incompatible).toEqual([]);
      expect(result.deferredSchemaPublications).toEqual([
        expect.objectContaining({
          kind: "state",
          path: statePath,
          foundVersion: CARAPACE_STATE_SCHEMA_VERSION - 1,
          contentVersion: CARAPACE_STATE_SCHEMA_VERSION,
          runId: run.runId,
          message: expect.stringContaining(
            `version publication deferred until update run ${run.runId} finishes`,
          ),
        }),
      ]);
      expect(result.indeterminate).toEqual(
        damaged
          ? [
              expect.objectContaining({
                kind: "state",
                reason: expect.stringContaining("column definitions differ for worktrees"),
              }),
            ]
          : [],
      );
      expect(snapshotSourceFamily(statePath)).toEqual(before);
      if (!damaged) {
        await expect(
          preflightCarapaceDatabaseSchemas({
            env,
            supportedVersions: {
              state: CARAPACE_STATE_SCHEMA_VERSION - 1,
              agent: CARAPACE_AGENT_SCHEMA_VERSION,
            },
          }),
        ).resolves.toMatchObject({
          incompatible: [expect.objectContaining({ foundVersion: CARAPACE_STATE_SCHEMA_VERSION })],
        });
        await expect(preflightCarapaceStateDatabasePath(statePath)).resolves.toMatchObject({
          status: "exact",
          foundVersion: CARAPACE_STATE_SCHEMA_VERSION - 1,
          contentVersion: CARAPACE_STATE_SCHEMA_VERSION,
          deferredPublication: expect.objectContaining({ runId: run.runId }),
        });
      }
    },
  );

  it("accepts an older v6 state database without the lazy setup id during restart preflight", async () => {
    const stateDir = tempDirs.make("carapace-database-preflight-older-v6-setup-id-");
    const env = { CARAPACE_STATE_DIR: stateDir };
    const statePath = openCarapaceStateDatabase({ env }).path;
    closeCarapaceStateDatabaseForTest();

    const { DatabaseSync } = requireNodeSqlite();
    const state = new DatabaseSync(statePath);
    try {
      state.exec("ALTER TABLE device_bootstrap_tokens DROP COLUMN setup_id;");
    } finally {
      state.close();
    }
    await expect(
      assertCarapaceDatabasesReady({ env, operation: "gateway-restart" }),
    ).resolves.toBeUndefined();
  });

  it("reports a current but noncanonical state schema as indeterminate", async () => {
    const stateDir = tempDirs.make("carapace-database-preflight-noncanonical-state-");
    const env = { CARAPACE_STATE_DIR: stateDir };
    const statePath = openCarapaceStateDatabase({ env }).path;
    closeCarapaceStateDatabaseForTest();

    const { DatabaseSync } = requireNodeSqlite();
    const state = new DatabaseSync(statePath);
    try {
      state.exec(
        "ALTER TABLE worktrees DROP COLUMN run_end_cleanup_json; " +
          "ALTER TABLE worktrees ADD COLUMN run_end_cleanup_json INTEGER;",
      );
    } finally {
      state.close();
    }

    expect(
      await preflightCarapaceDatabaseSchemas({
        env,
        verifyCurrentSchemaShape: true,
        supportedVersions: {
          state: CARAPACE_STATE_SCHEMA_VERSION,
          agent: CARAPACE_AGENT_SCHEMA_VERSION,
        },
      }),
    ).toEqual({
      incompatible: [],
      indeterminate: [
        {
          kind: "state",
          path: statePath,
          reason: expect.stringContaining("column definitions differ for worktrees"),
        },
      ],
    });
    await expect(
      assertCarapaceDatabasesReady({ env, operation: "gateway-restart" }),
    ).rejects.toThrow(/Gateway refused restart.*column definitions differ for worktrees/u);
  });

  it.each(["default", "configured"])(
    "checks an unregistered %s store without creating shared state",
    async (layout) => {
      const stateDir = tempDirs.make("carapace-unregistered-readiness-");
      const env = { CARAPACE_STATE_DIR: stateDir };
      const customPath = path.join(tempDirs.make("carapace-configured-readiness-"), "agent.sqlite");
      const agent = openCarapaceAgentDatabase({
        agentId: "main",
        env,
        ...(layout === "configured" ? { path: customPath } : {}),
      });
      const statePath = resolveCarapaceStateSqlitePath(env);
      closeCarapaceAgentDatabasesForTest();
      closeCarapaceStateDatabaseForTest();
      fs.unlinkSync(statePath);
      const { DatabaseSync } = requireNodeSqlite();
      const database = new DatabaseSync(agent.path);
      // Consolidate the fixture so ordinary SQLite WAL coordination is not
      // mistaken for readiness creating or migrating a persistent database.
      database.exec("PRAGMA journal_mode = DELETE;");
      database.close();
      const options = {
        env,
        operation: "doctor" as const,
        configuredAgentDatabaseTargets:
          layout === "configured" ? [{ agentId: "main", path: agent.path }] : [],
      };
      const before = snapshotSourceFamily(agent.path);
      await expect(assertCarapaceDatabasesReady(options)).resolves.toBeUndefined();
      expect(snapshotSourceFamily(agent.path)).toEqual(before);
      expect(fs.existsSync(statePath)).toBe(false);
      const legacyWriter = new DatabaseSync(agent.path);
      legacyWriter.exec(
        "DROP TABLE session_participants; PRAGMA user_version = 17; UPDATE schema_meta SET schema_version = 17;",
      );
      legacyWriter.close();
      const legacy = snapshotSourceFamily(agent.path);
      await expect(assertCarapaceDatabasesReady(options)).rejects.toThrow(
        /Doctor.*database readiness.*schema version 17/,
      );
      expect(snapshotSourceFamily(agent.path)).toEqual(legacy);
      expect(fs.existsSync(statePath)).toBe(false);
    },
  );

  it("leaves archive-only state alone when no runtime database exists", async () => {
    const stateDir = tempDirs.make("carapace-readiness-archive-only-");
    const env = { CARAPACE_STATE_DIR: stateDir };
    const archivePath = path.join(
      stateDir,
      "agents",
      "main",
      "sessions",
      "old.jsonl.deleted.2026-07-24T01-02-04.000Z",
    );
    fs.mkdirSync(path.dirname(archivePath), { recursive: true });
    fs.writeFileSync(archivePath, "unreadable archive\n");
    const before = snapshotSourceFamily(archivePath);
    await expect(
      assertCarapaceDatabasesReady({
        env,
        operation: "doctor",
        configuredAgentDatabaseTargets: [],
      }),
    ).resolves.toBeUndefined();
    expect(snapshotSourceFamily(archivePath)).toEqual(before);
    expect(fs.existsSync(resolveCarapaceStateSqlitePath(env))).toBe(false);
    expect(fs.existsSync(path.join(stateDir, "agents", "main", "agent"))).toBe(false);
  });

  it("collects newer state and registered agent schemas with writer builds", async () => {
    const stateDir = tempDirs.make("carapace-database-preflight-");
    const env = { CARAPACE_STATE_DIR: stateDir };
    const statePath = openCarapaceStateDatabase({ env }).path;
    const agentPath = openCarapaceAgentDatabase({ agentId: "worker-1", env }).path;
    closeCarapaceAgentDatabasesForTest();
    closeCarapaceStateDatabaseForTest();

    const { DatabaseSync } = requireNodeSqlite();
    const state = new DatabaseSync(statePath);
    try {
      state.exec(`PRAGMA user_version = ${CARAPACE_STATE_SCHEMA_VERSION + 1};`);
      state
        .prepare("UPDATE schema_meta SET app_version = ? WHERE meta_key = 'primary'")
        .run("state-writer-build");
    } finally {
      state.close();
    }
    const agent = new DatabaseSync(agentPath);
    try {
      agent.exec(`PRAGMA user_version = ${CARAPACE_AGENT_SCHEMA_VERSION + 1};`);
      agent
        .prepare("UPDATE schema_meta SET app_version = ? WHERE meta_key = 'primary'")
        .run("agent-writer-build");
    } finally {
      agent.close();
    }

    expect(
      await preflightCarapaceDatabaseSchemas({
        env,
        supportedVersions: {
          state: CARAPACE_STATE_SCHEMA_VERSION,
          agent: CARAPACE_AGENT_SCHEMA_VERSION,
        },
      }),
    ).toEqual({
      incompatible: [
        {
          kind: "state",
          path: statePath,
          foundVersion: CARAPACE_STATE_SCHEMA_VERSION + 1,
          supportedVersion: CARAPACE_STATE_SCHEMA_VERSION,
          writerAppVersion: "state-writer-build",
        },
        {
          kind: "agent",
          path: agentPath,
          agentId: "worker-1",
          foundVersion: CARAPACE_AGENT_SCHEMA_VERSION + 1,
          supportedVersion: CARAPACE_AGENT_SCHEMA_VERSION,
          writerAppVersion: "agent-writer-build",
        },
      ],
      indeterminate: [],
    });
  });

  it.each(["absent", "installed", "drifted"])(
    "preflights the %s transcript eligibility index without repairing it",
    async (shape) => {
      const stateDir = tempDirs.make("carapace-transcript-eligibility-preflight-");
      const env = { CARAPACE_STATE_DIR: stateDir };
      const agentPath = openCarapaceAgentDatabase({ agentId: "worker-1", env }).path;
      closeCarapaceAgentDatabasesForTest();
      closeCarapaceStateDatabaseForTest();
      const { DatabaseSync } = requireNodeSqlite();
      const agent = new DatabaseSync(agentPath);
      try {
        if (shape !== "installed") {
          agent.exec("DROP INDEX idx_agent_transcript_context_pending");
          if (shape === "absent") {
            agent.exec("ALTER TABLE session_transcript_active_events DROP COLUMN context_eligible");
          } else {
            agent.exec(
              "CREATE INDEX idx_agent_transcript_context_pending ON session_transcript_active_events(event_seq)",
            );
          }
        }
      } finally {
        agent.close();
      }
      const result = await preflightCarapaceDatabaseSchemas({
        env,
        verifyCurrentSchemaShape: true,
        supportedVersions: {
          state: CARAPACE_STATE_SCHEMA_VERSION,
          agent: CARAPACE_AGENT_SCHEMA_VERSION,
        },
      });
      expect(result.incompatible).toEqual([]);
      expect(result.indeterminate).toEqual(
        shape === "drifted"
          ? [
              {
                kind: "agent",
                path: agentPath,
                reason: expect.stringContaining("idx_agent_transcript_context_pending"),
              },
            ]
          : [],
      );
      const inspected = new DatabaseSync(agentPath, { readOnly: true });
      try {
        expect(
          inspected
            .prepare(
              "SELECT name FROM pragma_table_info('session_transcript_active_events') WHERE name = 'context_eligible'",
            )
            .get(),
        ).toEqual(shape === "absent" ? undefined : { name: "context_eligible" });
        expect(inspected.prepare("PRAGMA user_version").get()).toEqual({
          user_version: CARAPACE_AGENT_SCHEMA_VERSION,
        });
      } finally {
        inspected.close();
      }
    },
  );

  it("checks every registered owner before permitting Gateway restart", async () => {
    const stateDir = tempDirs.make("carapace-preflight-conflicting-owners-");
    const env = { CARAPACE_STATE_DIR: stateDir };
    const agentPath = openCarapaceAgentDatabase({ agentId: "main", env }).path;
    const statePath = resolveCarapaceStateSqlitePath(env);
    closeCarapaceAgentDatabasesForTest();
    closeCarapaceStateDatabaseForTest();
    const { DatabaseSync } = requireNodeSqlite();
    const registry = new DatabaseSync(statePath);
    registry
      .prepare(
        "INSERT INTO agent_databases (agent_id, path, schema_version, last_seen_at, size_bytes) VALUES (?, ?, ?, ?, ?)",
      )
      .run("ops", agentPath, CARAPACE_AGENT_SCHEMA_VERSION, 1, null);
    registry.close();

    await expect(
      assertCarapaceDatabasesReady({ env, operation: "gateway-restart" }),
    ).rejects.toThrow(/Gateway refused restart.*belongs to agent main; requested agent ops/);
    const result = await preflightCarapaceDatabaseSchemas({
      env,
      supportedVersions: {
        state: CARAPACE_STATE_SCHEMA_VERSION,
        agent: CARAPACE_AGENT_SCHEMA_VERSION,
      },
      verifyCurrentSchemaShape: true,
      configuredAgentDatabaseCandidatePaths: [agentPath],
    });
    expect(result.indeterminate).toEqual([
      {
        kind: "agent",
        path: agentPath,
        reason: expect.stringContaining("belongs to agent main; requested agent ops"),
      },
    ]);
  });

  it("reports a current but noncanonical registered agent schema as indeterminate", async () => {
    const stateDir = tempDirs.make("carapace-database-preflight-noncanonical-agent-");
    const env = { CARAPACE_STATE_DIR: stateDir };
    const agentPath = openCarapaceAgentDatabase({ agentId: "worker-1", env }).path;
    closeCarapaceAgentDatabasesForTest();
    closeCarapaceStateDatabaseForTest();

    const { DatabaseSync } = requireNodeSqlite();
    const agent = new DatabaseSync(agentPath);
    try {
      agent.exec(
        "ALTER TABLE schema_meta ADD COLUMN unexpected TEXT CHECK (length(unexpected) > 0);",
      );
    } finally {
      agent.close();
    }

    expect(
      await preflightCarapaceDatabaseSchemas({
        env,
        verifyCurrentSchemaShape: true,
        supportedVersions: {
          state: CARAPACE_STATE_SCHEMA_VERSION,
          agent: CARAPACE_AGENT_SCHEMA_VERSION,
        },
      }),
    ).toEqual({
      incompatible: [],
      indeterminate: [
        {
          kind: "agent",
          path: agentPath,
          reason: expect.stringContaining("column definitions differ for schema_meta"),
        },
      ],
    });
  });

  it("reports an existing unreadable state database as indeterminate", async () => {
    const stateDir = tempDirs.make("carapace-database-preflight-unreadable-state-");
    const env = { CARAPACE_STATE_DIR: stateDir };
    const statePath = openCarapaceStateDatabase({ env }).path;
    closeCarapaceStateDatabaseForTest();
    fs.writeFileSync(statePath, "not a sqlite database");

    expect(
      await preflightCarapaceDatabaseSchemas({
        env,
        supportedVersions: {
          state: CARAPACE_STATE_SCHEMA_VERSION,
          agent: CARAPACE_AGENT_SCHEMA_VERSION,
        },
      }),
    ).toEqual({
      incompatible: [],
      indeterminate: [
        { kind: "state", path: statePath, reason: expect.stringMatching(/database|file/iu) },
      ],
    });
  });

  it("reports a failed agent registry query as indeterminate", async () => {
    const stateDir = tempDirs.make("carapace-database-preflight-registry-");
    const env = { CARAPACE_STATE_DIR: stateDir };
    const statePath = openCarapaceStateDatabase({ env }).path;
    closeCarapaceStateDatabaseForTest();
    const { DatabaseSync } = requireNodeSqlite();
    const state = new DatabaseSync(statePath);
    try {
      state.exec("DROP TABLE agent_databases; CREATE TABLE agent_databases (bad TEXT) STRICT;");
    } finally {
      state.close();
    }

    expect(
      await preflightCarapaceDatabaseSchemas({
        env,
        supportedVersions: {
          state: CARAPACE_STATE_SCHEMA_VERSION,
          agent: CARAPACE_AGENT_SCHEMA_VERSION,
        },
      }),
    ).toEqual({
      incompatible: [],
      indeterminate: [
        {
          kind: "state",
          path: statePath,
          reason: expect.stringContaining("agent database registry query failed"),
        },
      ],
    });
  });

  it("reports an existing unreadable registered agent database as indeterminate", async () => {
    const stateDir = tempDirs.make("carapace-database-preflight-unreadable-agent-");
    const env = { CARAPACE_STATE_DIR: stateDir };
    const agentPath = openCarapaceAgentDatabase({ agentId: "worker-1", env }).path;
    closeCarapaceAgentDatabasesForTest();
    closeCarapaceStateDatabaseForTest();
    fs.writeFileSync(agentPath, "not a sqlite database");

    expect(
      await preflightCarapaceDatabaseSchemas({
        env,
        supportedVersions: {
          state: CARAPACE_STATE_SCHEMA_VERSION,
          agent: CARAPACE_AGENT_SCHEMA_VERSION,
        },
      }),
    ).toEqual({
      incompatible: [],
      indeterminate: [
        { kind: "agent", path: agentPath, reason: expect.stringMatching(/database|file/iu) },
      ],
    });
  });

  it.runIf(process.platform !== "win32")(
    "keeps partial configured-store inventory when one candidate lookup is denied",
    async () => {
      const stateDir = tempDirs.make("carapace-configured-candidate-lookup-");
      const visibleDir = tempDirs.make("carapace-configured-visible-");
      const deniedDir = tempDirs.make("carapace-configured-denied-");
      const visiblePath = path.join(visibleDir, "newer.sqlite");
      const deniedPath = path.join(deniedDir, "owned.sqlite");
      const absentPath = path.join(visibleDir, "absent.sqlite");
      const { DatabaseSync } = requireNodeSqlite();
      for (const databasePath of [visiblePath, deniedPath]) {
        const database = new DatabaseSync(databasePath);
        database.exec(
          `PRAGMA user_version = ${CARAPACE_AGENT_SCHEMA_VERSION + (databasePath === visiblePath ? 1 : 0)};`,
        );
        database.close();
      }

      fs.chmodSync(deniedDir, 0o000);
      let result: Awaited<ReturnType<typeof preflightCarapaceDatabaseSchemas>>;
      try {
        result = await preflightCarapaceDatabaseSchemas({
          env: { CARAPACE_STATE_DIR: stateDir },
          supportedVersions: {
            state: CARAPACE_STATE_SCHEMA_VERSION,
            agent: CARAPACE_AGENT_SCHEMA_VERSION,
          },
          configuredAgentDatabaseCandidatePaths: [visiblePath, deniedPath, absentPath],
        });
      } finally {
        fs.chmodSync(deniedDir, 0o700);
      }

      expect(result).toEqual({
        incompatible: [
          {
            kind: "agent",
            path: visiblePath,
            foundVersion: CARAPACE_AGENT_SCHEMA_VERSION + 1,
            supportedVersion: CARAPACE_AGENT_SCHEMA_VERSION,
          },
        ],
        indeterminate: [
          {
            kind: "agent",
            path: deniedPath,
            reason: expect.stringMatching(/EACCES|permission denied/iu),
          },
        ],
      });
    },
  );
});

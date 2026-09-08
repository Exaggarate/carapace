import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareAgentDeleteDatabases } from "../agents/agent-delete-databases.js";
import { beginAgentDeletionJournal } from "./agent-deletion-journal.js";
import { CARAPACE_AGENT_SCHEMA_VERSION } from "./carapace-agent-db-contract.js";
import { withCarapaceAgentDatabaseReadOnly } from "./carapace-agent-db-readonly.js";
import {
  closeCarapaceAgentDatabaseByPath,
  closeCarapaceAgentDatabases,
  closeCarapaceAgentDatabasesForTest,
  IncognitoAgentDatabasePathCollisionError,
  listCarapaceRegisteredAgentDatabases,
  listOpenIncognitoAgentDatabases,
  openCarapaceAgentDatabase,
  readOpenIncognitoAgentDatabaseGeneration,
  resolveIncognitoCarapaceAgentSqlitePath,
  runCarapaceAgentWriteTransaction,
} from "./carapace-agent-db.js";
import { closeCarapaceStateDatabaseForTest } from "./carapace-state-db.js";

const tempDirs: string[] = [];

afterEach(() => {
  closeCarapaceAgentDatabasesForTest();
  closeCarapaceStateDatabaseForTest();
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { force: true, recursive: true });
  }
});

describe("incognito agent database", () => {
  it.each([false, true])(
    "rejects deletion-fenced opens and writes and retires prepared statements (held: %s)",
    (held) => {
      const stateDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "incognito-delete-")));
      tempDirs.push(stateDir);
      const env = { CARAPACE_STATE_DIR: stateDir };
      const sentinel = resolveIncognitoCarapaceAgentSqlitePath({ agentId: "worker", env });
      const options = { agentId: "worker", env, path: sentinel };
      const database = held ? openCarapaceAgentDatabase(options) : undefined;
      const writeSql =
        "UPDATE schema_meta SET updated_at = updated_at + 1 WHERE meta_key = 'primary'";
      const retained = database?.db.prepare(writeSql);
      beginAgentDeletionJournal(
        {
          agentId: "worker",
          operationId: "delete-worker",
          agentDir: path.dirname(sentinel),
          workspaceDir: path.join(stateDir, "workspace-worker"),
          sessionsDir: path.join(stateDir, "agents", "worker", "sessions"),
          deleteFiles: true,
        },
        { env },
      );

      expect.soft(() => openCarapaceAgentDatabase(options)).toThrow("is deleted");
      expect
        .soft(() =>
          runCarapaceAgentWriteTransaction(({ db }) => db.prepare(writeSql).run(), options),
        )
        .toThrow("is deleted");
      const plan = prepareAgentDeleteDatabases(
        { agents: { entries: { worker: {}, kept: {} } } },
        "worker",
        path.dirname(sentinel),
        { env },
      );
      if (database && retained) {
        expect.soft(database.db.isOpen).toBe(false);
        expect.soft(() => retained.run()).toThrow();
      }
      expect(plan.registrationPaths).not.toContain(sentinel);
      expect(plan.fileGroups.flat()).not.toContain(sentinel);
      expect(fs.existsSync(sentinel)).toBe(false);
    },
  );

  it("does not allocate an in-memory database for a read-only miss", () => {
    const stateDir = fs.realpathSync(
      fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "carapace-incognito-read-miss-")),
    );
    tempDirs.push(stateDir);
    const env = { CARAPACE_STATE_DIR: stateDir };
    const sentinel = resolveIncognitoCarapaceAgentSqlitePath({ agentId: "main", env });
    const before = listOpenIncognitoAgentDatabases();

    expect(
      withCarapaceAgentDatabaseReadOnly(() => "unreachable", {
        agentId: "main",
        env,
        path: sentinel,
      }),
    ).toEqual({ found: false, reason: "database-missing" });
    expect(listOpenIncognitoAgentDatabases()).toEqual(before);
    expect(fs.existsSync(sentinel)).toBe(false);
  });

  it("refuses a file at the reserved sentinel path before opening in memory", () => {
    const stateDir = fs.realpathSync(
      fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "carapace-incognito-collision-")),
    );
    tempDirs.push(stateDir);
    const env = { CARAPACE_STATE_DIR: stateDir };
    const sentinel = resolveIncognitoCarapaceAgentSqlitePath({ agentId: "main", env });
    fs.mkdirSync(path.dirname(sentinel), { recursive: true });
    fs.writeFileSync(sentinel, "operator data", "utf8");

    let collision: unknown;
    try {
      openCarapaceAgentDatabase({ agentId: "main", env, path: sentinel });
    } catch (error) {
      collision = error;
    }
    expect(collision).toBeInstanceOf(IncognitoAgentDatabasePathCollisionError);
    expect(collision).toMatchObject({
      name: "IncognitoAgentDatabasePathCollisionError",
      path: sentinel,
      message: expect.stringContaining("move or rename the file"),
    });

    fs.rmSync(sentinel);
    const database = openCarapaceAgentDatabase({ agentId: "main", env, path: sentinel });
    expect(database.db.prepare("SELECT count(*) AS count FROM session_nodes").get()).toEqual({
      count: 0,
    });
    expect(fs.existsSync(sentinel)).toBe(false);
  });

  it("boots the canonical schema in one cached memory handle without touching its sentinel path", () => {
    const stateDir = fs.realpathSync(
      fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "carapace-incognito-db-")),
    );
    tempDirs.push(stateDir);
    const env = { CARAPACE_STATE_DIR: stateDir };
    const sentinel = resolveIncognitoCarapaceAgentSqlitePath({ agentId: "main", env });
    const beforeGeneration = readOpenIncognitoAgentDatabaseGeneration();

    const first = openCarapaceAgentDatabase({ agentId: "main", env, path: sentinel });
    const openedGeneration = readOpenIncognitoAgentDatabaseGeneration();
    const reopened = openCarapaceAgentDatabase({ agentId: "main", env, path: sentinel });

    expect(openedGeneration).toBeGreaterThan(beforeGeneration);
    expect(readOpenIncognitoAgentDatabaseGeneration()).toBe(openedGeneration);
    expect(reopened).toBe(first);
    expect(fs.readdirSync(stateDir)).toEqual([]);
    expect(listOpenIncognitoAgentDatabases()).toEqual([{ agentId: "main", storePath: sentinel }]);
    expect(listCarapaceRegisteredAgentDatabases({ env })).toEqual([]);
    expect(
      withCarapaceAgentDatabaseReadOnly((database) => database.db === first.db, {
        agentId: "main",
        env,
        path: sentinel,
      }),
    ).toEqual({ found: true, value: true });
    expect(
      first.db
        .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'session_nodes'")
        .get(),
    ).toEqual({ name: "session_nodes" });
    expect(first.db.prepare("PRAGMA user_version").get()).toEqual({
      user_version: CARAPACE_AGENT_SCHEMA_VERSION,
    });
    expect(() =>
      withCarapaceAgentDatabaseReadOnly(
        ({ db }) => db.prepare("SELECT * FROM missing_readonly_table").all(),
        { agentId: "main", env, path: sentinel },
      ),
    ).toThrow(/no such table: missing_readonly_table/);
    expect(first.db.isOpen).toBe(true);
    expect(fs.existsSync(sentinel)).toBe(false);
    expect(fs.existsSync(path.dirname(sentinel))).toBe(false);

    expect(closeCarapaceAgentDatabaseByPath(sentinel)).toBe(true);
    const closedGeneration = readOpenIncognitoAgentDatabaseGeneration();
    expect(closedGeneration).toBeGreaterThan(openedGeneration);
    expect(closeCarapaceAgentDatabaseByPath(sentinel)).toBe(false);
    expect(readOpenIncognitoAgentDatabaseGeneration()).toBe(closedGeneration);
  });

  it("advances once when close-all removes incognito membership", () => {
    const stateDir = fs.realpathSync(
      fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "carapace-incognito-close-all-")),
    );
    tempDirs.push(stateDir);
    const env = { CARAPACE_STATE_DIR: stateDir };
    const sentinel = resolveIncognitoCarapaceAgentSqlitePath({ agentId: "main", env });
    openCarapaceAgentDatabase({ agentId: "main", env, path: sentinel });
    const openedGeneration = readOpenIncognitoAgentDatabaseGeneration();

    closeCarapaceAgentDatabases();
    const closedGeneration = readOpenIncognitoAgentDatabaseGeneration();
    expect(closedGeneration).toBeGreaterThan(openedGeneration);

    closeCarapaceAgentDatabases();
    expect(readOpenIncognitoAgentDatabaseGeneration()).toBe(closedGeneration);
  });
});

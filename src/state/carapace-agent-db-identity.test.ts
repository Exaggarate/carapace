import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { CarapaceAgentDatabaseClaim } from "./carapace-agent-db-identity.js";
import { retainCarapaceAgentDatabaseReadOnly } from "./carapace-agent-db-readonly.js";
import {
  closeCarapaceAgentDatabaseByPath,
  closeCarapaceAgentDatabasesForTest,
  isCarapaceAgentDatabaseOpen,
  listCarapaceRegisteredAgentDatabases,
  openCarapaceAgentDatabase,
  resolveIncognitoCarapaceAgentSqlitePath,
} from "./carapace-agent-db.js";
import { closeCarapaceStateDatabaseForTest } from "./carapace-state-db.js";

let directory: string;
let env: NodeJS.ProcessEnv;
const claims: CarapaceAgentDatabaseClaim[] = [];

beforeEach(() => {
  directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agent-db-identity-")));
  env = { CARAPACE_STATE_DIR: directory };
});

afterEach(() => {
  for (const claim of claims.splice(0)) {
    claim.release();
  }
  closeCarapaceAgentDatabasesForTest();
  closeCarapaceStateDatabaseForTest();
  fs.rmSync(directory, { recursive: true, force: true });
});

function retain(databasePath: string): CarapaceAgentDatabaseClaim {
  const result = retainCarapaceAgentDatabaseReadOnly({ agentId: "main", env, path: databasePath });
  if (!result.found) {
    throw new Error(`Expected existing database: ${result.reason}`);
  }
  claims.push(result.claim);
  return result.claim;
}

it.runIf(process.platform !== "win32")(
  "keeps physical identity and lexical close ownership through a symlink retarget",
  () => {
    const original = openCarapaceAgentDatabase({ agentId: "main", env });
    const alias = path.join(directory, "alias.sqlite");
    fs.symlinkSync(original.path, alias);
    const aliased = openCarapaceAgentDatabase({ agentId: "main", env, path: alias });
    const claim = retain(alias);
    const replacement = openCarapaceAgentDatabase({
      agentId: "main",
      env,
      path: path.join(directory, "replacement.sqlite"),
    });
    const originalIdentity = retain(original.path).identity;
    const replacementIdentity = retain(replacement.path).identity;
    expect(claim.identity).toBe(originalIdentity);
    fs.unlinkSync(alias);
    fs.symlinkSync(replacement.path, alias);

    expect(openCarapaceAgentDatabase({ agentId: "main", env, path: alias })).toBe(aliased);
    expect(claim.identity).toBe(originalIdentity);
    expect(claim.identity).not.toBe(replacementIdentity);
    expect(closeCarapaceAgentDatabaseByPath(alias)).toBe(true);
    expect(claim.isCurrent()).toBe(false);
    expect(() => claim.assertCurrent()).toThrow("no longer current");
    expect(original.db.isOpen).toBe(true);
    expect(replacement.db.isOpen).toBe(true);
    const current = retain(alias);
    expect(current.identity).toBe(replacementIdentity);
    expect(claim.isCurrent()).toBe(false);
  },
);

it("retains cold existing stores read-only without registering or creating missing stores", () => {
  const database = openCarapaceAgentDatabase({ agentId: "main", env });
  closeCarapaceAgentDatabaseByPath(database.path);
  const registry = listCarapaceRegisteredAgentDatabases({ env });
  const claim = retain(database.path);
  expect(claim.isCurrent()).toBe(true);
  expect(isCarapaceAgentDatabaseOpen(database.path)).toBe(false);
  expect(() => claim.database.db.exec("CREATE TABLE unexpected (value TEXT)")).toThrow(/readonly/);
  expect(listCarapaceRegisteredAgentDatabases({ env })).toEqual(registry);
  claim.release();
  expect(claim.database.db.isOpen).toBe(false);
  expect(() => claim.assertCurrent()).toThrow("no longer current");

  const missing = path.join(directory, "missing", "agent.sqlite");
  expect(retainCarapaceAgentDatabaseReadOnly({ agentId: "main", env, path: missing })).toEqual({
    found: false,
    reason: "database-missing",
  });
  expect(fs.existsSync(path.dirname(missing))).toBe(false);
});

it("releases only one warm claim while revoking its retained copies", () => {
  const database = openCarapaceAgentDatabase({ agentId: "main", env });
  const first = retain(database.path);
  const second = retain(database.path);
  const assertCurrent = first.assertCurrent;
  first.release();
  first.release();
  expect(() => assertCurrent()).toThrow("no longer current");
  expect(second.isCurrent()).toBe(true);
  expect(database.db.isOpen).toBe(true);
});

it("does not reuse incognito authority after the same sentinel is reopened", () => {
  const sentinel = resolveIncognitoCarapaceAgentSqlitePath({ agentId: "main", env });
  expect(retainCarapaceAgentDatabaseReadOnly({ agentId: "main", env, path: sentinel })).toEqual({
    found: false,
    reason: "database-missing",
  });
  openCarapaceAgentDatabase({ agentId: "main", env, path: sentinel });
  const claim = retain(sentinel);
  closeCarapaceAgentDatabaseByPath(sentinel);
  openCarapaceAgentDatabase({ agentId: "main", env, path: sentinel });
  const replacement = retain(sentinel);
  expect(claim.identity).not.toBe(replacement.identity);
  expect(claim.isCurrent()).toBe(false);
  expect(replacement.isCurrent()).toBe(true);
  expect(fs.existsSync(sentinel)).toBe(false);
  expect(listCarapaceRegisteredAgentDatabases({ env })).toEqual([]);
});

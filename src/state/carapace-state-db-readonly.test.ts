import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { withTempDir } from "../test-utils/temp-dir.js";
import {
  withExistingCarapaceStateDatabaseArtifactPreservingReadOnly,
  withExistingCarapaceStateDatabaseReadOnly,
  withArtifactPreservingStateReads,
} from "./carapace-state-db-readonly.js";
import {
  closeCarapaceStateDatabaseForTest,
  openCarapaceStateDatabase,
} from "./carapace-state-db.js";

function createOptions(stateDir: string) {
  return {
    env: { CARAPACE_STATE_DIR: stateDir, CARAPACE_TEST_FAST: "1" },
    path: path.join(stateDir, "state", "carapace.sqlite"),
  };
}

afterEach(() => {
  closeCarapaceStateDatabaseForTest();
});

describe.each(["admission", "explicit"] as const)("%s read-only state reads", (mode) => {
  const readState: typeof withExistingCarapaceStateDatabaseReadOnly =
    mode === "admission"
      ? (operation, options) =>
          withArtifactPreservingStateReads(() =>
            withExistingCarapaceStateDatabaseReadOnly(operation, options),
          )
      : withExistingCarapaceStateDatabaseArtifactPreservingReadOnly;
  it("reads a consolidated WAL database without creating source sidecars", async () => {
    await withTempDir("carapace-state-readonly-sidecars-", async (stateDir) => {
      const options = createOptions(stateDir);
      fs.mkdirSync(path.dirname(options.path), { recursive: true });
      const writer = new DatabaseSync(options.path);
      writer.exec(
        "PRAGMA journal_mode = WAL; CREATE TABLE held(value TEXT); INSERT INTO held VALUES ('committed');",
      );
      writer.close();
      const before = fs.readFileSync(options.path);
      expect(fs.readdirSync(path.dirname(options.path))).toEqual(["carapace.sqlite"]);

      expect(readState(({ db }) => db.prepare("SELECT value FROM held").all(), options)).toEqual([
        { value: "committed" },
      ]);
      expect(fs.readdirSync(path.dirname(options.path))).toEqual(["carapace.sqlite"]);
      expect(fs.readFileSync(options.path)).toEqual(before);
    });
  });
  it.each(["cached", "uncached"])(
    "reads committed rows without joining a %s transaction",
    async (cacheState) => {
      await withTempDir("carapace-state-readonly-isolated-", async (stateDir) => {
        const options = createOptions(stateDir);
        const opened = openCarapaceStateDatabase(options);
        opened.db.exec("CREATE TABLE held(value TEXT); INSERT INTO held VALUES ('original');");
        if (cacheState === "uncached") {
          closeCarapaceStateDatabaseForTest();
        }
        const writer = cacheState === "cached" ? opened.db : new DatabaseSync(options.path);
        writer.exec("BEGIN; UPDATE held SET value = 'uncommitted';");
        try {
          const result = readState(({ db, path: pathname }) => {
            expect(db).not.toBe(writer);
            expect(pathname).toBe(options.path);
            return db.prepare("SELECT value FROM held").all();
          }, options);
          expect(result).toEqual([{ value: "original" }]);
          expect(writer.isTransaction).toBe(true);
          expect(writer.prepare("SELECT value FROM held").all()).toEqual([
            { value: "uncommitted" },
          ]);
        } finally {
          writer.exec("ROLLBACK");
          if (cacheState === "uncached") {
            writer.close();
          }
        }
      });
    },
  );

  it("reuses an idle writable handle without preparing a snapshot", async () => {
    await withTempDir("carapace-state-readonly-reuse-", async (stateDir) => {
      const options = createOptions(stateDir);
      const opened = openCarapaceStateDatabase(options);
      opened.db.exec("CREATE TABLE held(value TEXT); INSERT INTO held VALUES ('original');");

      const result = readState(({ db }) => {
        expect(db).toBe(opened.db);
        return db.prepare("SELECT value FROM held").all();
      }, options);
      expect(result).toEqual([{ value: "original" }]);
    });
  });
});

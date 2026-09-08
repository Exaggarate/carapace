import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { CARAPACE_STATE_SCHEMA_VERSION } from "./carapace-state-db-contract.js";
import {
  closeCarapaceStateDatabaseForTest,
  openCarapaceStateDatabase,
} from "./carapace-state-db.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);

afterEach(() => {
  closeCarapaceStateDatabaseForTest();
});

describe("shared state runtime schema fence", () => {
  it("latches a newer schema committed under an open cached handle", () => {
    const options = { env: { CARAPACE_STATE_DIR: tempDirs.make("carapace-runtime-schema-") } };
    const initial = openCarapaceStateDatabase(options);
    const external = new DatabaseSync(initial.path);
    try {
      external.exec(`
        BEGIN IMMEDIATE;
        PRAGMA user_version = ${CARAPACE_STATE_SCHEMA_VERSION + 1};
        UPDATE schema_meta
           SET schema_version = ${CARAPACE_STATE_SCHEMA_VERSION + 1},
               app_version = 'future-build'
         WHERE meta_key = 'primary';
        COMMIT;
      `);
    } finally {
      external.close();
    }

    let failure: unknown;
    try {
      openCarapaceStateDatabase(options);
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      name: "SqliteSchemaVersionError",
      message: expect.stringContaining(
        `uses newer schema version ${CARAPACE_STATE_SCHEMA_VERSION + 1}`,
      ),
    });
    expect(initial.db.isOpen).toBe(false);
    expect(() => openCarapaceStateDatabase(options)).toThrow(failure);
  });

  it("retains the cached handle after a compatible external data commit", () => {
    const options = { env: { CARAPACE_STATE_DIR: tempDirs.make("carapace-runtime-data-") } };
    const initial = openCarapaceStateDatabase(options);
    const external = new DatabaseSync(initial.path);
    try {
      external.exec(`
        UPDATE schema_meta
           SET updated_at = updated_at + 1
         WHERE meta_key = 'primary';
      `);
    } finally {
      external.close();
    }

    expect(openCarapaceStateDatabase(options)).toBe(initial);
    expect(initial.db.isOpen).toBe(true);
  });
});

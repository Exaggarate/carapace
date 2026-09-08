// Delivery queue helper tests cover shared SQLite and temp-directory cleanup.
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isCarapaceStateDatabaseOpen,
  openCarapaceStateDatabase,
} from "../../state/carapace-state-db.js";
import { installDeliveryQueueTmpDirHooks } from "./delivery-queue.test-helpers.js";

const fixture = installDeliveryQueueTmpDirHooks();
let previousTmpDir = "";

describe("installDeliveryQueueTmpDirHooks", () => {
  it("tracks an open per-case state database", () => {
    previousTmpDir = fixture.tmpDir();
    openCarapaceStateDatabase({ env: { ...process.env, CARAPACE_STATE_DIR: previousTmpDir } });

    expect(isCarapaceStateDatabaseOpen()).toBe(true);
    expect(fs.existsSync(previousTmpDir)).toBe(true);
  });

  it("closes handles and removes the previous case directory", () => {
    expect(isCarapaceStateDatabaseOpen()).toBe(false);
    expect(fs.existsSync(previousTmpDir)).toBe(false);
  });
});

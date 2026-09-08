import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import {
  closeCarapaceStateDatabaseByPath,
  openCarapaceStateDatabase,
} from "../state/carapace-state-db.js";
import { createWorkerRuntimeEnvironment } from "./worker.runtime.js";

it("closes the worker state database before removing its directory without closing other state", async () => {
  const unrelatedRoot = await mkdtemp(path.join(tmpdir(), "carapace-worker-unrelated-"));
  const unrelated = openCarapaceStateDatabase({
    path: path.join(unrelatedRoot, "carapace.sqlite"),
  });
  const environment = await createWorkerRuntimeEnvironment("worker-state-cleanup");
  const owned = openCarapaceStateDatabase();
  try {
    expect(owned.db.isOpen).toBe(true);
    expect(unrelated.db.isOpen).toBe(true);

    await environment.close();

    expect(owned.db.isOpen).toBe(false);
    expect(unrelated.db.isOpen).toBe(true);
    expect(unrelated.db.prepare("SELECT 1 AS value").get()).toEqual({ value: 1 });
    await expect(stat(environment.stateDir)).rejects.toMatchObject({ code: "ENOENT" });
    await environment.close();
  } finally {
    closeCarapaceStateDatabaseByPath(owned.path);
    closeCarapaceStateDatabaseByPath(unrelated.path);
    await rm(environment.stateDir, { recursive: true, force: true });
    await rm(unrelatedRoot, { recursive: true, force: true });
  }
});

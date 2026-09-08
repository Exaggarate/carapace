import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";

const resolvePreferredCarapaceTmpDirMock = vi.hoisted(() => vi.fn());

vi.mock("./tmp-carapace-dir.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./tmp-carapace-dir.js")>();
  return {
    ...actual,
    resolvePreferredCarapaceTmpDir: resolvePreferredCarapaceTmpDirMock,
  };
});

import { withInstallWorkspace } from "./install-source-utils.js";

describe("withInstallWorkspace private root", () => {
  const tempDirs = useAutoCleanupTempDirTracker(afterEach);

  it.runIf(process.platform !== "win32")(
    "preserves parent temp root permissions when using private Carapace temp root",
    async () => {
      const mockParentRoot = tempDirs.make("carapace-chmod-test-");
      const mockCarapaceDir = path.join(mockParentRoot, "carapace");

      await fs.mkdir(mockCarapaceDir, { recursive: true });
      await fs.chmod(mockParentRoot, 0o1777);
      const canonicalCarapaceDir = await fs.realpath(mockCarapaceDir);

      resolvePreferredCarapaceTmpDirMock.mockReturnValue(mockCarapaceDir);

      let observedDir = "";
      const value = await withInstallWorkspace("carapace-test-", async (tmpDir) => {
        observedDir = tmpDir;
        expect(path.dirname(tmpDir)).toBe(canonicalCarapaceDir);
        await fs.writeFile(path.join(tmpDir, "marker.txt"), "ok");
        return "done";
      });

      expect(value).toBe("done");

      await expect(
        fs.stat(observedDir).then(
          () => true,
          () => false,
        ),
      ).resolves.toBe(false);

      const privateRootStat = await fs.stat(mockCarapaceDir);
      expect(privateRootStat.mode & 0o7777).toBe(0o700);

      const parentStat = await fs.stat(mockParentRoot);
      expect(parentStat.mode & 0o7777).toBe(0o1777);
    },
  );
});

// Doctor state integrity cloud-storage tests cover macOS cloud-synced state directory detection.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTempDirTracker } from "../../test/helpers/temp-dir.js";
import { detectMacCloudSyncedStateDir } from "./doctor-state-integrity.js";

const tempDirs = createTempDirTracker();

afterEach(() => {
  tempDirs.cleanup();
});

describe("detectMacCloudSyncedStateDir", () => {
  const home = "/Users/tester";

  it("detects state dir under iCloud Drive", () => {
    const stateDir = path.join(
      home,
      "Library",
      "Mobile Documents",
      "com~apple~CloudDocs",
      "Carapace",
      ".carapace",
    );

    const result = detectMacCloudSyncedStateDir(stateDir, {
      platform: "darwin",
      homedir: home,
    });

    expect(result).toEqual({
      path: path.resolve(stateDir),
      storage: "iCloud Drive",
    });
  });

  it("detects state dir under Library/CloudStorage", () => {
    const stateDir = path.join(home, "Library", "CloudStorage", "Dropbox", "Carapace", ".carapace");

    const result = detectMacCloudSyncedStateDir(stateDir, {
      platform: "darwin",
      homedir: home,
    });

    expect(result).toEqual({
      path: path.resolve(stateDir),
      storage: "CloudStorage provider",
    });
  });

  it("detects cloud-synced target when state dir resolves via symlink", () => {
    const symlinkPath = "/tmp/carapace-state";
    const resolvedCloudPath = path.join(
      home,
      "Library",
      "CloudStorage",
      "OneDrive-Personal",
      "Carapace",
      ".carapace",
    );

    const result = detectMacCloudSyncedStateDir(symlinkPath, {
      platform: "darwin",
      homedir: home,
      resolveRealPath: () => resolvedCloudPath,
    });

    expect(result).toEqual({
      path: path.resolve(resolvedCloudPath),
      storage: "CloudStorage provider",
    });
  });

  it("ignores cloud-synced symlink prefix when resolved target is local", () => {
    const symlinkPath = path.join(
      home,
      "Library",
      "CloudStorage",
      "OneDrive-Personal",
      "Carapace",
      ".carapace",
    );
    const resolvedLocalPath = path.join(home, ".carapace");

    const result = detectMacCloudSyncedStateDir(symlinkPath, {
      platform: "darwin",
      homedir: home,
      resolveRealPath: () => resolvedLocalPath,
    });

    expect(result).toBeNull();
  });

  it("follows a real symlink out of the sync root when the state dir leaf is absent", () => {
    const sandbox = fs.realpathSync(tempDirs.make("carapace-cloud-storage-symlink-"));
    const realHome = path.join(sandbox, "home");
    const cloudStorage = path.join(realHome, "Library", "CloudStorage");
    const localTarget = path.join(sandbox, "local-carapace");
    fs.mkdirSync(cloudStorage, { recursive: true });
    fs.mkdirSync(localTarget, { recursive: true });
    const syncedLink = path.join(cloudStorage, "OneDrive-Personal");
    fs.symlinkSync(localTarget, syncedLink, process.platform === "win32" ? "junction" : "dir");

    const stateDir = path.join(syncedLink, "Carapace", ".carapace");
    expect(fs.existsSync(stateDir)).toBe(false);

    expect(
      detectMacCloudSyncedStateDir(stateDir, {
        platform: "darwin",
        homedir: realHome,
      }),
    ).toBeNull();
  });

  it("still warns for a real absent leaf that stays inside the sync root", () => {
    const sandbox = fs.realpathSync(tempDirs.make("carapace-cloud-storage-real-"));
    const realHome = path.join(sandbox, "home");
    const syncedDir = path.join(
      realHome,
      "Library",
      "CloudStorage",
      "OneDrive-Personal",
      "Carapace",
    );
    fs.mkdirSync(syncedDir, { recursive: true });

    const stateDir = path.join(syncedDir, ".carapace");
    expect(fs.existsSync(stateDir)).toBe(false);

    expect(
      detectMacCloudSyncedStateDir(stateDir, {
        platform: "darwin",
        homedir: realHome,
      }),
    ).toEqual({
      path: path.resolve(stateDir),
      storage: "CloudStorage provider",
    });
  });

  it("anchors cloud detection to OS homedir when CARAPACE_HOME is overridden", () => {
    const stateDir = path.join(home, "Library", "CloudStorage", "iCloud Drive", ".carapace");
    const originalCarapaceHome = process.env.CARAPACE_HOME;
    process.env.CARAPACE_HOME = "/tmp/carapace-home-override";
    const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(home);
    try {
      const result = detectMacCloudSyncedStateDir(stateDir, {
        platform: "darwin",
      });

      expect(result).toEqual({
        path: path.resolve(stateDir),
        storage: "CloudStorage provider",
      });
    } finally {
      homedirSpy.mockRestore();
      if (originalCarapaceHome === undefined) {
        delete process.env.CARAPACE_HOME;
      } else {
        process.env.CARAPACE_HOME = originalCarapaceHome;
      }
    }
  });

  it("returns null outside darwin", () => {
    const stateDir = path.join(
      home,
      "Library",
      "Mobile Documents",
      "com~apple~CloudDocs",
      "Carapace",
      ".carapace",
    );

    const result = detectMacCloudSyncedStateDir(stateDir, {
      platform: "linux",
      homedir: home,
    });

    expect(result).toBeNull();
  });
});

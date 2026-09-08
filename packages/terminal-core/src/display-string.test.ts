// Terminal Core tests cover display-safe path shortening.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDisplayStringFormatter } from "./display-string.js";

function stubHome(home: string, carapaceHome = ""): void {
  vi.stubEnv("HOME", home);
  vi.stubEnv("USERPROFILE", "");
  vi.stubEnv("CARAPACE_HOME", carapaceHome);
}

describe("createDisplayStringFormatter", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("shortens whole-value homes and child paths without clipping sibling prefixes", () => {
    const home = path.resolve("test-home", "alice");
    stubHome(home);
    const displayString = createDisplayStringFormatter();

    expect(displayString(home)).toBe("~");
    expect(displayString(`${home}/project`)).toBe("~/project");
    expect(displayString(`${home}\\project`)).toBe("~\\project");
    expect(displayString(`Workspace: ${home}/project`)).toBe("Workspace: ~/project");
    expect(displayString(`${home}/one ${home}/two`)).toBe("~/one ~/two");
    expect(displayString(`Home: ${home},`)).toBe("Home: ~,");
    expect(displayString(`(${home})`)).toBe("(~)");
    expect(displayString(`${home}.`)).toBe("~.");

    expect(displayString(`${home}2/project`)).toBe(`${home}2/project`);
    expect(displayString(`${home},backup`)).toBe(`${home},backup`);
    expect(displayString(`${home} backup/project`)).toBe(`${home} backup/project`);
    expect(displayString(`${home}../project`)).toBe(`${home}../project`);
    expect(displayString(`prefix${home}/project`)).toBe(`prefix${home}/project`);
    expect(displayString(`/tmp${home}/project`)).toBe(`/tmp${home}/project`);
  });

  it("uses CARAPACE_HOME as the display prefix", () => {
    const home = path.resolve("test-home", "alice");
    const carapaceHome = path.resolve("test-carapace-home");
    stubHome(home, carapaceHome);
    const displayString = createDisplayStringFormatter();

    expect(displayString(carapaceHome)).toBe("$CARAPACE_HOME");
    expect(displayString(`${carapaceHome}/state`)).toBe("$CARAPACE_HOME/state");
    expect(displayString(`${carapaceHome}2/state`)).toBe(`${carapaceHome}2/state`);
  });

  it.each(["$&", "$`", "$'", "$$"])("keeps %s literal when expanding CARAPACE_HOME", (pattern) => {
    const home = path.resolve("test-home", `${pattern}user`);
    stubHome(home, "~/state");
    const displayString = createDisplayStringFormatter();

    expect(displayString(path.join(home, "state", "project"))).toBe(
      `$CARAPACE_HOME${path.sep}project`,
    );
  });

  it.skipIf(process.platform !== "win32")(
    "shortens real Windows home casing aliases inside table display text",
    () => {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), "carapace-home-display-"));
      try {
        const homeAlias = home.toUpperCase();
        expect(fs.statSync(homeAlias).isDirectory()).toBe(true);
        stubHome(home);
        const displayString = createDisplayStringFormatter();

        expect(displayString(`Workspace: ${homeAlias}\\project`)).toBe("Workspace: ~\\project");
        expect(displayString(`İ Workspace: ${homeAlias}\\project`)).toBe("İ Workspace: ~\\project");
      } finally {
        fs.rmSync(home, { recursive: true, force: true });
      }
    },
  );
});

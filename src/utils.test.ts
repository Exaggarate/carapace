// Tests shared utility helpers used by CLI and runtime modules.
import fs from "node:fs";
import path from "node:path";
import { MAX_TIMER_TIMEOUT_MS } from "@carapace/normalization-core/number-coercion";
import { describe, expect, it, vi } from "vitest";
import { isAbortError } from "./infra/abort-signal.js";
import { withTestDir } from "./test-helpers/temp-dir.js";
import { withEnv } from "./test-utils/env.js";
import {
  CONFIG_DIR,
  ensureDir,
  normalizeE164,
  pinConfigDir,
  resolveConfigDir,
  resolveHomeDir,
  resolveUserPath,
  shortenHomeInString,
  shortenHomePath,
  sleep,
} from "./utils.js";

describe("ensureDir", () => {
  it("creates nested directory", async () => {
    await withTestDir({ prefix: "carapace-test-" }, async (tmp) => {
      const target = path.join(tmp, "nested", "dir");
      await ensureDir(target);
      expect(fs.existsSync(target)).toBe(true);
    });
  });
});

describe("sleep", () => {
  it("resolves after delay using fake timers", async () => {
    vi.useFakeTimers();
    try {
      const promise = sleep(1000);
      vi.advanceTimersByTime(1000);
      await expect(promise).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("clamps oversized sleep delays before scheduling", async () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    try {
      const promise = sleep(Number.MAX_SAFE_INTEGER);

      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), MAX_TIMER_TIMEOUT_MS);

      vi.advanceTimersByTime(MAX_TIMER_TIMEOUT_MS);
      await expect(promise).resolves.toBeUndefined();
    } finally {
      setTimeoutSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("rejects a pre-aborted zero-duration wait with the canonical abort error", async () => {
    const controller = new AbortController();
    const reason = new Error("cancelled");
    controller.abort(reason);

    const error = await sleep(0, controller.signal).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ name: "AbortError", message: "aborted", cause: reason });
    expect(isAbortError(error)).toBe(true);
  });

  it("rejects a pre-aborted positive-duration wait", async () => {
    const controller = new AbortController();
    const reason = new Error("cancelled");
    controller.abort(reason);

    await expect(sleep(1, controller.signal)).rejects.toMatchObject({
      name: "AbortError",
      message: "aborted",
      cause: reason,
    });
  });

  it("resolves a non-aborted zero-duration wait without scheduling", async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    try {
      await expect(sleep(0, new AbortController().signal)).resolves.toBeUndefined();
      expect(setTimeoutSpy).not.toHaveBeenCalled();
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });

  it("removes abort listeners after normal resolution", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const removeListenerSpy = vi.spyOn(controller.signal, "removeEventListener");
    try {
      const promise = sleep(5, controller.signal);

      await vi.advanceTimersByTimeAsync(5);
      await expect(promise).resolves.toBeUndefined();

      expect(removeListenerSpy).toHaveBeenCalledWith("abort", expect.any(Function));
    } finally {
      removeListenerSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("rejects cancellation with the canonical abort classification and cause", async () => {
    const controller = new AbortController();
    const reason = new Error("stop");
    const promise = sleep(60_000, controller.signal);

    controller.abort(reason);

    const error = await promise.catch((caught: unknown) => caught);
    expect(error).toMatchObject({ name: "AbortError", message: "aborted", cause: reason });
    expect(isAbortError(error)).toBe(true);
  });
});

describe("normalizeE164", () => {
  it.each([
    ["+1234567890", "+1234567890"],
    ["++1234567890", "+1234567890"],
    ["1+234+567", "+1234567"],
    ["whatsapp:+1 (234) 567-8900", "+12345678900"],
    ["signal: 1 234 567", "+1234567"],
    ["not a phone number", ""],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeE164(input)).toBe(expected);
  });
});

describe("resolveConfigDir", () => {
  it("resolves the default config directory", async () => {
    await withTestDir({ prefix: "carapace-config-dir-" }, async (root) => {
      const newDir = path.join(root, ".carapace");
      await fs.promises.mkdir(newDir, { recursive: true });
      const resolved = resolveConfigDir({} as NodeJS.ProcessEnv, () => root);
      expect(resolved).toBe(newDir);
    });
  });

  it("expands CARAPACE_STATE_DIR using the provided env", () => {
    const env = {
      HOME: "/tmp/carapace-home",
      CARAPACE_STATE_DIR: "~/state",
    } as NodeJS.ProcessEnv;

    expect(resolveConfigDir(env)).toBe(path.resolve("/tmp/carapace-home", "state"));
  });

  it("falls back to the config file directory when only CARAPACE_CONFIG_PATH is set", () => {
    const env = {
      HOME: "/tmp/carapace-home",
      CARAPACE_CONFIG_PATH: "~/profiles/dev/carapace.json",
    } as NodeJS.ProcessEnv;

    expect(resolveConfigDir(env)).toBe(path.resolve("/tmp/carapace-home", "profiles", "dev"));
  });

  it("re-pins the exported configuration root after startup environment selection", () => {
    const originalConfigDir = CONFIG_DIR;
    const selectedConfigDir = path.resolve("/tmp/carapace-selected-config-root");
    try {
      expect(
        pinConfigDir({
          CARAPACE_STATE_DIR: selectedConfigDir,
          CARAPACE_TEST_FAST: "1",
        }),
      ).toBe(selectedConfigDir);
      expect(CONFIG_DIR).toBe(selectedConfigDir);
    } finally {
      pinConfigDir({
        CARAPACE_STATE_DIR: originalConfigDir,
        CARAPACE_TEST_FAST: "1",
      });
    }
  });
});

describe("resolveHomeDir", () => {
  it("prefers CARAPACE_HOME over HOME", () => {
    withEnv({ CARAPACE_HOME: "/srv/carapace-home", HOME: "/home/other" }, () => {
      expect(resolveHomeDir()).toBe(path.resolve("/srv/carapace-home"));
    });
  });
});

describe("shortenHomePath", () => {
  it("uses $CARAPACE_HOME prefix when CARAPACE_HOME is set", () => {
    withEnv({ CARAPACE_HOME: "/srv/carapace-home", HOME: "/home/other" }, () => {
      expect(shortenHomePath(`${path.resolve("/srv/carapace-home")}/.carapace/carapace.json`)).toBe(
        "$CARAPACE_HOME/.carapace/carapace.json",
      );
    });
  });

  it.skipIf(process.platform === "win32")("keeps POSIX home matching case-sensitive", () => {
    withEnv({ CARAPACE_HOME: "/srv/Carapace-Home", HOME: "/home/other" }, () => {
      expect(shortenHomePath("/srv/carapace-home/workspace")).toBe("/srv/carapace-home/workspace");
    });
  });

  it.skipIf(process.platform !== "win32")("keeps relative Windows paths relative", () => {
    withEnv({ CARAPACE_HOME: process.cwd() }, () => {
      expect(shortenHomePath(`relative${path.sep}workspace`)).toBe(`relative${path.sep}workspace`);
    });
  });

  it.skipIf(process.platform !== "win32")(
    "shortens real extended-length Windows home aliases without exposing the absolute path",
    async () => {
      await withTestDir({ prefix: "carapace-home-display-" }, async (home) => {
        const workspace = path.join(home, "workspace");
        await fs.promises.mkdir(workspace);
        const extendedAlias = `\\\\?\\${workspace.toUpperCase()}`;
        expect(fs.statSync(extendedAlias).isDirectory()).toBe(true);

        withEnv({ CARAPACE_HOME: home }, () => {
          const display = shortenHomePath(extendedAlias);
          expect(display).toBe(`$CARAPACE_HOME${path.sep}WORKSPACE`);
          expect(display).not.toContain(home.toUpperCase());
        });
      });
    },
  );
});

describe("shortenHomeInString", () => {
  it("uses $CARAPACE_HOME replacement when CARAPACE_HOME is set", () => {
    withEnv({ CARAPACE_HOME: "/srv/carapace-home", HOME: "/home/other" }, () => {
      expect(
        shortenHomeInString(
          `config: ${path.resolve("/srv/carapace-home")}/.carapace/carapace.json`,
        ),
      ).toBe("config: $CARAPACE_HOME/.carapace/carapace.json");
    });
  });

  it.skipIf(process.platform === "win32")(
    "keeps embedded POSIX home matching case-sensitive",
    () => {
      withEnv({ CARAPACE_HOME: "/srv/Carapace-Home", HOME: "/home/other" }, () => {
        expect(shortenHomeInString("config: /srv/carapace-home/carapace.json")).toBe(
          "config: /srv/carapace-home/carapace.json",
        );
      });
    },
  );

  it.skipIf(process.platform !== "win32")(
    "shortens real Windows home casing aliases inside diagnostic text",
    async () => {
      await withTestDir({ prefix: "carapace-home-display-" }, async (home) => {
        const homeAlias = home.toUpperCase();
        expect(fs.statSync(homeAlias).isDirectory()).toBe(true);

        withEnv({ CARAPACE_HOME: home }, () => {
          expect(shortenHomeInString(`config: ${homeAlias}\\carapace.json`)).toBe(
            "config: $CARAPACE_HOME\\carapace.json",
          );
        });
      });
    },
  );
});

describe("resolveUserPath", () => {
  it("expands ~ to home dir", () => {
    expect(resolveUserPath("~", {}, () => "/Users/thoffman")).toBe(path.resolve("/Users/thoffman"));
  });

  it("expands ~/ to home dir", () => {
    expect(resolveUserPath("~/carapace", {}, () => "/Users/thoffman")).toBe(
      path.resolve("/Users/thoffman", "carapace"),
    );
  });

  it("resolves relative paths", () => {
    expect(resolveUserPath("tmp/dir")).toBe(path.resolve("tmp/dir"));
  });

  it("prefers CARAPACE_HOME for tilde expansion", () => {
    withEnv({ CARAPACE_HOME: "/srv/carapace-home", HOME: "/home/other" }, () => {
      expect(resolveUserPath("~/carapace")).toBe(path.resolve("/srv/carapace-home", "carapace"));
    });
  });

  it("uses the provided env for tilde expansion", () => {
    const env = {
      HOME: "/tmp/carapace-home",
      CARAPACE_HOME: "/srv/carapace-home",
    } as NodeJS.ProcessEnv;

    expect(resolveUserPath("~/carapace", env)).toBe(path.resolve("/srv/carapace-home", "carapace"));
  });

  it("keeps blank paths blank", () => {
    expect(resolveUserPath("")).toBe("");
    expect(resolveUserPath("   ")).toBe("");
  });
});

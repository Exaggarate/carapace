// Verify Plugin Npm Published Runtime tests cover verify plugin npm published runtime script behavior.
import { describe, expect, it } from "vitest";
import {
  collectPluginNpmPublishedRuntimeErrors,
  findPackedPackageReadmePath,
  parseVerifyPublishedPluginRuntimeArgs,
  parseNpmReadmeMetadata,
  readPluginNpmCommandOptions,
  resolveNpmPackFilename,
  runPluginNpmCommand,
  usage,
} from "../../scripts/verify-plugin-npm-published-runtime.mts";

describe("plugin npm publish verifier args", () => {
  it("parses help and package specs before npm calls", () => {
    expect(parseVerifyPublishedPluginRuntimeArgs(["--help"])).toEqual({ help: true, spec: "" });
    expect(parseVerifyPublishedPluginRuntimeArgs(["--", "@carapace/discord@2026.5.2"])).toEqual({
      help: false,
      spec: "@carapace/discord@2026.5.2",
    });
  });

  it("rejects unknown and extra args before npm calls", () => {
    expect(() => parseVerifyPublishedPluginRuntimeArgs([])).toThrow(usage());
    expect(() => parseVerifyPublishedPluginRuntimeArgs(["--wat"])).toThrow(
      "Unknown plugin npm verifier option: --wat",
    );
    expect(() =>
      parseVerifyPublishedPluginRuntimeArgs(["@carapace/discord@2026.5.2", "extra"]),
    ).toThrow("Unexpected plugin npm verifier argument: extra");
  });
});

describe("plugin npm publish verifier command limits", () => {
  it("bounds npm command runtime and captured output by default", () => {
    expect(readPluginNpmCommandOptions({})).toStrictEqual({
      encoding: "utf8",
      killSignal: "SIGKILL",
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5 * 60 * 1000,
    });
  });

  it("accepts strict npm command timeout and buffer overrides", () => {
    expect(
      readPluginNpmCommandOptions({
        CARAPACE_PLUGIN_NPM_COMMAND_MAX_BUFFER_BYTES: "33554432",
        CARAPACE_PLUGIN_NPM_COMMAND_TIMEOUT_MS: "120000",
      }),
    ).toMatchObject({
      maxBuffer: 32 * 1024 * 1024,
      timeout: 120000,
    });
  });

  it("rejects loose npm command timeout and buffer overrides", () => {
    for (const value of ["60s", "1e3", "0"]) {
      expect(() =>
        readPluginNpmCommandOptions({ CARAPACE_PLUGIN_NPM_COMMAND_TIMEOUT_MS: value }),
      ).toThrow(`invalid CARAPACE_PLUGIN_NPM_COMMAND_TIMEOUT_MS: ${value}`);
    }
    expect(() =>
      readPluginNpmCommandOptions({
        CARAPACE_PLUGIN_NPM_COMMAND_MAX_BUFFER_BYTES: "16mb",
      }),
    ).toThrow("invalid CARAPACE_PLUGIN_NPM_COMMAND_MAX_BUFFER_BYTES: 16mb");
  });

  it("runs npm metadata commands with bounded exec options", () => {
    const calls: unknown[] = [];
    const output = runPluginNpmCommand(["view", "@carapace/discord", "readme"], {
      env: {
        CARAPACE_PLUGIN_NPM_COMMAND_MAX_BUFFER_BYTES: "1024",
        CARAPACE_PLUGIN_NPM_COMMAND_TIMEOUT_MS: "2500",
      },
      execFileSyncImpl(command: string, args: string[], options: unknown) {
        calls.push({ args, command, options });
        return JSON.stringify("# Discord");
      },
    });

    expect(output).toBe(JSON.stringify("# Discord"));
    expect(calls).toStrictEqual([
      {
        args: ["view", "@carapace/discord", "readme"],
        command: "npm",
        options: {
          encoding: "utf8",
          killSignal: "SIGKILL",
          maxBuffer: 1024,
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 2500,
        },
      },
    ]);
  });
});

describe("collectPluginNpmPublishedRuntimeErrors", () => {
  it.each([".ts", ".tsx", ".mts", ".cts"])(
    "rejects source-only %s runtime and setup entries",
    (extension) => {
      const errors = collectPluginNpmPublishedRuntimeErrors({
        packageJson: {
          name: "entry-fixture",
          carapace: {
            extensions: [`./src/index${extension}`],
            setupEntry: `./src/setup${extension}`,
          },
        },
        files: ["carapace.plugin.json", `src/index${extension}`, `src/setup${extension}`],
      });
      expect(errors).toEqual([
        expect.stringContaining(
          `compiled runtime output for TypeScript entry ./src/index${extension}`,
        ),
        expect.stringContaining(
          `compiled runtime output for TypeScript entry ./src/setup${extension}`,
        ),
      ]);
    },
  );

  it.each([
    [".ts", ".js"],
    [".tsx", ".js"],
    [".mts", ".mjs"],
    [".cts", ".cjs"],
  ])("accepts nested compiler output for %s entries without source", (source, output) => {
    expect(
      collectPluginNpmPublishedRuntimeErrors({
        packageJson: {
          name: "entry-fixture",
          carapace: {
            extensions: [`./src/index${source}`],
            setupEntry: `./src/setup${source}`,
          },
        },
        files: ["carapace.plugin.json", `dist/src/index${output}`, `dist/src/setup${output}`],
      }),
    ).toEqual([]);
  });

  it("flags published plugin packages with TypeScript entries and no compiled runtime output", () => {
    expect(
      collectPluginNpmPublishedRuntimeErrors({
        spec: "@carapace/discord@2026.5.2",
        packageJson: {
          name: "@carapace/discord",
          version: "2026.5.2",
          carapace: {
            extensions: ["./index.ts"],
          },
        },
        files: ["package.json", "carapace.plugin.json", "index.ts"],
      }),
    ).toEqual([
      "@carapace/discord@2026.5.2 requires compiled runtime output for TypeScript entry ./index.ts: expected ./dist/index.js, ./dist/index.mjs, ./dist/index.cjs, ./index.js, ./index.mjs, ./index.cjs",
    ]);
  });

  it("accepts published plugin packages with explicit runtimeExtensions", () => {
    expect(
      collectPluginNpmPublishedRuntimeErrors({
        packageJson: {
          name: "@carapace/zalo",
          version: "2026.5.3",
          carapace: {
            extensions: ["./index.ts"],
            runtimeExtensions: ["./dist/index.js"],
          },
        },
        files: ["package.json", "carapace.plugin.json", "index.ts", "dist/index.js"],
      }),
    ).toStrictEqual([]);
  });

  it("flags plugin npm packages without an Carapace plugin manifest", () => {
    expect(
      collectPluginNpmPublishedRuntimeErrors({
        packageJson: {
          name: "@carapace/searxng-plugin",
          version: "2026.6.11",
          carapace: {
            extensions: ["./index.ts"],
            runtimeExtensions: ["./dist/index.js"],
          },
        },
        files: ["package.json", "dist/index.js"],
      }),
    ).toEqual([
      "@carapace/searxng-plugin@2026.6.11 plugin npm package must include carapace.plugin.json",
    ]);
  });

  it("flags reservation packages before they can pass plugin runtime verification", () => {
    expect(
      collectPluginNpmPublishedRuntimeErrors({
        packageJson: {
          name: "@carapace/tavily-plugin",
          version: "0.0.0",
          description: "Bootstrap reservation",
        },
        files: ["package.json", "README.md"],
      }),
    ).toEqual([
      "@carapace/tavily-plugin@0.0.0 plugin npm package must include carapace.plugin.json",
    ]);
  });

  it("flags missing explicit runtimeExtensions outputs", () => {
    expect(
      collectPluginNpmPublishedRuntimeErrors({
        packageJson: {
          name: "@carapace/line",
          version: "2026.5.3",
          carapace: {
            extensions: ["./src/index.ts"],
            runtimeExtensions: ["./dist/index.js"],
          },
        },
        files: ["package.json", "carapace.plugin.json", "src/index.ts"],
      }),
    ).toEqual(["@carapace/line@2026.5.3 runtime extension entry not found: ./dist/index.js"]);
  });

  it("flags runtimeExtensions length mismatches", () => {
    expect(
      collectPluginNpmPublishedRuntimeErrors({
        packageJson: {
          name: "@carapace/acpx",
          version: "2026.5.3",
          carapace: {
            extensions: ["./index.ts", "./tools.ts"],
            runtimeExtensions: ["./dist/index.js"],
          },
        },
        files: ["package.json", "carapace.plugin.json", "dist/index.js"],
      }),
    ).toEqual([
      "@carapace/acpx@2026.5.3 package.json carapace.runtimeExtensions length (1) must match carapace.extensions length (2)",
    ]);
  });

  it("flags blank runtimeExtensions entries instead of falling back to inferred outputs", () => {
    expect(
      collectPluginNpmPublishedRuntimeErrors({
        packageJson: {
          name: "@carapace/whatsapp",
          version: "2026.5.3",
          carapace: {
            extensions: ["./src/index.ts"],
            runtimeExtensions: [" "],
          },
        },
        files: ["package.json", "carapace.plugin.json", "src/index.ts", "dist/index.js"],
      }),
    ).toEqual([
      "@carapace/whatsapp@2026.5.3 package.json carapace.runtimeExtensions[0] must be a non-empty string",
    ]);
  });

  it("flags published plugin packages with TypeScript setup entries and no compiled setup runtime", () => {
    expect(
      collectPluginNpmPublishedRuntimeErrors({
        packageJson: {
          name: "@carapace/line",
          version: "2026.5.3",
          carapace: {
            extensions: ["./index.ts"],
            runtimeExtensions: ["./dist/index.js"],
            setupEntry: "./setup-entry.ts",
          },
        },
        files: [
          "package.json",
          "carapace.plugin.json",
          "index.ts",
          "dist/index.js",
          "setup-entry.ts",
        ],
      }),
    ).toEqual([
      "@carapace/line@2026.5.3 requires compiled runtime output for TypeScript entry ./setup-entry.ts: expected ./dist/setup-entry.js, ./dist/setup-entry.mjs, ./dist/setup-entry.cjs, ./setup-entry.js, ./setup-entry.mjs, ./setup-entry.cjs",
    ]);
  });

  it("accepts published plugin packages with explicit runtimeSetupEntry", () => {
    expect(
      collectPluginNpmPublishedRuntimeErrors({
        packageJson: {
          name: "@carapace/example-channel",
          version: "2026.5.3",
          carapace: {
            extensions: ["./index.ts"],
            runtimeExtensions: ["./dist/index.js"],
            setupEntry: "./setup-entry.ts",
            runtimeSetupEntry: "./dist/setup-entry.js",
          },
        },
        files: ["package.json", "carapace.plugin.json", "dist/index.js", "dist/setup-entry.js"],
      }),
    ).toStrictEqual([]);
  });

  it("flags missing explicit runtimeSetupEntry outputs", () => {
    expect(
      collectPluginNpmPublishedRuntimeErrors({
        packageJson: {
          name: "@carapace/matrix",
          version: "2026.5.3",
          carapace: {
            extensions: ["./index.ts"],
            runtimeExtensions: ["./dist/index.js"],
            setupEntry: "./setup-entry.ts",
            runtimeSetupEntry: "./dist/setup-entry.js",
          },
        },
        files: ["package.json", "carapace.plugin.json", "dist/index.js"],
      }),
    ).toEqual(["@carapace/matrix@2026.5.3 runtime setup entry not found: ./dist/setup-entry.js"]);
  });

  it("flags runtimeSetupEntry without setupEntry", () => {
    expect(
      collectPluginNpmPublishedRuntimeErrors({
        packageJson: {
          name: "@carapace/twitch",
          version: "2026.5.3",
          carapace: {
            extensions: ["./index.ts"],
            runtimeExtensions: ["./dist/index.js"],
            runtimeSetupEntry: "./dist/setup-entry.js",
          },
        },
        files: ["package.json", "carapace.plugin.json", "dist/index.js", "dist/setup-entry.js"],
      }),
    ).toEqual([
      "@carapace/twitch@2026.5.3 package.json carapace.runtimeSetupEntry requires carapace.setupEntry",
    ]);
  });
});

describe("resolveNpmPackFilename", () => {
  it("uses the final tarball filename from plain npm pack output", () => {
    const noisyOutput = [
      "npm notice",
      "npm notice package: @carapace/msteams@2026.5.24-beta.1",
      "carapace-msteams-2026.5.24-beta.1.tgz",
      "",
    ].join("\n");

    expect(resolveNpmPackFilename(noisyOutput)).toBe("carapace-msteams-2026.5.24-beta.1.tgz");
  });

  it("rejects path-like tarball output instead of reading outside the pack directory", () => {
    const unsafeOutputs = [
      "../carapace-msteams.tgz",
      "nested/carapace-msteams.tgz",
      "nested\\carapace-msteams.tgz",
      "/tmp/carapace-msteams.tgz",
      "C:\\temp\\carapace-msteams.tgz",
      "carapace-msteams\u0000.tgz",
    ];

    for (const output of unsafeOutputs) {
      expect(() => resolveNpmPackFilename(output)).toThrow(
        "npm pack did not report a tarball filename",
      );
    }
  });
});

describe("findPackedPackageReadmePath", () => {
  it("finds a root package README without accepting nested documentation files", () => {
    expect(
      findPackedPackageReadmePath(["package.json", "docs/README.md", "README.md", "dist/index.js"]),
    ).toBe("README.md");
    expect(findPackedPackageReadmePath(["package.json", "docs/README.md"])).toBe("");
  });
});

describe("parseNpmReadmeMetadata", () => {
  it.each([
    { npm: "<=11", payload: "# Plugin\n\nInstall it." },
    { npm: "12", payload: ["# Plugin\n\nInstall it."] },
  ])("accepts non-empty npm $npm readme metadata", ({ payload }) => {
    expect(parseNpmReadmeMetadata(JSON.stringify(payload))).toBe("# Plugin\n\nInstall it.");
  });

  it("rejects empty or unsupported npm readme metadata", () => {
    expect(parseNpmReadmeMetadata(JSON.stringify(""))).toBe("");
    expect(parseNpmReadmeMetadata(JSON.stringify(null))).toBe("");
    expect(parseNpmReadmeMetadata(JSON.stringify([]))).toBe("");
    expect(parseNpmReadmeMetadata(JSON.stringify(["# One", "# Two"]))).toBe("");
    expect(parseNpmReadmeMetadata("{")).toBe("");
  });
});

// Argv invocation tests cover CLI argv normalization before command dispatch.
import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { resolveCliArgvInvocation } from "./argv-invocation.js";
import { getCommanderCommandPath } from "./program/commander-parse-facts.js";

describe("argv-invocation", () => {
  it("resolves root help and empty command path", () => {
    expect(resolveCliArgvInvocation(["node", "carapace", "--help"])).toEqual({
      argv: ["node", "carapace", "--help"],
      commandPath: [],
      primary: null,
      hasHelpOrVersion: true,
      isRootHelpInvocation: true,
    });
  });

  it("resolves command path and primary with root options", () => {
    expect(
      resolveCliArgvInvocation(["node", "carapace", "--profile", "work", "gateway", "status"]),
    ).toEqual({
      argv: ["node", "carapace", "--profile", "work", "gateway", "status"],
      commandPath: ["gateway", "status"],
      primary: "gateway",
      hasHelpOrVersion: false,
      isRootHelpInvocation: false,
    });
  });

  it.each([
    {
      name: "version-pinned install",
      argv: ["node", "carapace", "skills", "install", "@owner/weather", "--version", "1.2.3"],
      commandPath: ["skills", "install"],
    },
    {
      name: "version-pinned verification",
      argv: ["node", "carapace", "skills", "verify", "@owner/weather", "--version", "1.2.3"],
      commandPath: ["skills", "verify"],
    },
    {
      name: "equals-form version-pinned install",
      argv: ["node", "carapace", "skills", "install", "@owner/weather", "--version=1.2.3"],
      commandPath: ["skills", "install"],
    },
    {
      name: "profiled version-pinned verification",
      argv: [
        "node",
        "carapace",
        "--profile",
        "work",
        "skills",
        "verify",
        "@owner/weather",
        "--version",
        "1.2.3",
      ],
      commandPath: ["skills", "verify"],
    },
  ])("keeps $name in command execution mode", ({ argv, commandPath }) => {
    expect(resolveCliArgvInvocation(argv)).toEqual({
      argv,
      commandPath,
      primary: "skills",
      hasHelpOrVersion: false,
      isRootHelpInvocation: false,
    });
  });

  it("consumes agent parent option values before the exec subcommand", () => {
    expect(
      resolveCliArgvInvocation([
        "node",
        "carapace",
        "agent",
        "--model",
        "openai/gpt-5.6-sol",
        "exec",
        "fix it",
      ]).commandPath,
    ).toEqual(["agent", "exec"]);
  });

  it("does not treat an exec-valued parent option as the subcommand", () => {
    expect(
      resolveCliArgvInvocation(["node", "carapace", "agent", "--message", "exec"]).commandPath,
    ).toEqual(["agent"]);
  });

  it("consumes root options between the agent parent and exec", () => {
    expect(
      resolveCliArgvInvocation([
        "node",
        "carapace",
        "agent",
        "--no-color",
        "--model",
        "openai/gpt-5.6-sol",
        "exec",
        "fix it",
      ]).commandPath,
    ).toEqual(["agent", "exec"]);
  });

  it.each([
    ["separate agent value", ["models", "--agent", "main", "--status-json"]],
    ["inline agent value", ["models", "--agent=main", "--status-json"]],
    ["status alias before agent", ["models", "--status-json", "--agent", "main"]],
  ])("keeps models parent status options on the parent path: %s", (_name, args) => {
    expect(resolveCliArgvInvocation(["node", "carapace", ...args]).commandPath).toEqual(["models"]);
  });

  it("still resolves a models child after parent options", () => {
    expect(
      resolveCliArgvInvocation(["node", "carapace", "models", "--agent", "main", "status"])
        .commandPath,
    ).toEqual(["models", "status"]);
  });

  it.each([
    ["config", ["--section", "model"], ["config"]],
    ["config", ["--section", "get"], ["config"]],
    ["config", ["--section=model", "get"], ["config", "get"]],
    ["config", ["--", "get"], ["config", "get"]],
    ["skills", ["--agent", "main", "verify"], ["skills", "verify"]],
    ["skills", ["--agent=main", "verify"], ["skills", "verify"]],
    ["skills", ["--agent", "verify"], ["skills"]],
    ["skills", ["--json", "--agent", "main", "verify"], ["skills", "verify"]],
    ["skills", ["--", "verify"], ["skills", "verify"]],
  ])("matches Commander for %s %j", async (rootName, args, expectedPath) => {
    const program = new Command().name("carapace").enablePositionalOptions();
    const root = program.command(rootName);
    if (rootName === "config") {
      root.option("--section <section>");
    } else {
      root.option("--agent <id>").option("--json");
    }
    const child = root.command(rootName === "config" ? "get" : "verify");
    let parsedPath: string[] = [];
    for (const command of [root, child]) {
      command.action(() => {
        parsedPath = getCommanderCommandPath(command);
      });
    }
    const argv = ["node", "carapace", rootName, ...args];

    await program.parseAsync(argv);

    expect(parsedPath).toEqual(expectedPath);
    expect(resolveCliArgvInvocation(argv).commandPath).toEqual(parsedPath);
  });

  it.each(["cleanup", "status", "repair", "finalize", "wizard"])(
    "resolves update %s after parent options and interleaved root options",
    (child) => {
      for (const args of [
        ["--channel", "beta", "--tag", "latest", "--timeout", "5", child],
        ["--channel=beta", "--no-color", "--timeout=5", "--yes", child],
        ["--", child],
      ]) {
        expect(
          resolveCliArgvInvocation(["node", "carapace", "--profile", "work", "update", ...args])
            .commandPath,
        ).toEqual(["update", child]);
      }
    },
  );

  it.each(["--channel", "--tag", "--timeout"])(
    "does not mistake a cleanup-valued %s for a child command",
    (flag) => {
      for (const args of [[flag, "cleanup"], [`${flag}=cleanup`], [flag]]) {
        expect(
          resolveCliArgvInvocation(["node", "carapace", "update", ...args]).commandPath,
        ).toEqual(["update"]);
      }
    },
  );

  it.each([
    ["update", "--channel=beta", "cleanup", "--help"],
    ["update", "--help", "cleanup"],
    ["help", "update", "cleanup"],
  ])("recognizes update help without promoting scoped version flags: %j", (...args) => {
    expect(resolveCliArgvInvocation(["node", "carapace", ...args]).hasHelpOrVersion).toBe(true);
  });

  it.each([
    ["update", "cleanup", "--version"],
    ["update", "cleanup", "--", "--help"],
    ["update", "--channel=--help", "cleanup"],
  ])("leaves scoped or literal help/version tokens to Commander: %j", (...args) => {
    expect(resolveCliArgvInvocation(["node", "carapace", ...args]).hasHelpOrVersion).toBe(false);
  });
});

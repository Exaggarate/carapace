// Argv tests cover CLI argument parsing helpers and platform-specific normalization.
import { Command } from "commander";
import { describe, expect, it } from "vitest";
import {
  buildParseArgv,
  getFlagValue,
  getCommandPositionalsWithRootOptions,
  getCommandPathWithRootOptions,
  getPrimaryCommand,
  getPositiveIntFlagValue,
  getVerboseFlag,
  hasFlag,
  isHelpOrVersionInvocation,
  isRootHelpInvocation,
  isRootVersionInvocation,
  isSimpleCommandHelpInvocation,
  normalizeGeneratedHelpCommandArgv,
  normalizeRootHelpTargetArgv,
  normalizeRootLogLevelArgv,
  normalizeRootNoColorArgv,
} from "./argv.js";

describe("argv helpers", () => {
  it.each([
    {
      name: "known command group help command help flag",
      argv: ["node", "carapace", "backup", "help", "--help"],
      expected: ["node", "carapace", "backup", "help"],
    },
    {
      name: "known command group help command short help flag",
      argv: ["node", "carapace", "--profile", "work", "backup", "help", "-h"],
      expected: ["node", "carapace", "--profile", "work", "backup", "help"],
    },
    {
      name: "leaf positional help remains untouched",
      argv: ["node", "carapace", "docs", "help", "--help"],
      expected: ["node", "carapace", "docs", "help", "--help"],
    },
    {
      name: "known command group help target",
      argv: ["node", "carapace", "plugins", "help", "list"],
      expected: ["node", "carapace", "plugins", "list", "--help"],
    },
    {
      name: "known command group help target help flag",
      argv: ["node", "carapace", "plugins", "help", "list", "--help"],
      expected: ["node", "carapace", "plugins", "list", "--help"],
    },
    {
      name: "unknown plugin command group help target",
      argv: ["node", "carapace", "external-plugin", "help", "inspect"],
      expected: ["node", "carapace", "external-plugin", "inspect", "--help"],
    },
    {
      name: "unknown plugin command group help target help flag",
      argv: ["node", "carapace", "external-plugin", "help", "inspect", "--help"],
      expected: ["node", "carapace", "external-plugin", "inspect", "--help"],
    },
    {
      name: "generated help target with trailing root option",
      argv: ["node", "carapace", "memory", "help", "status", "--no-color"],
      expected: ["node", "carapace", "--no-color", "memory", "status", "--help"],
    },
    {
      name: "extra help positionals remain untouched",
      argv: ["node", "carapace", "backup", "help", "missing", "extra", "--help"],
      expected: ["node", "carapace", "backup", "help", "missing", "extra", "--help"],
    },
    {
      name: "terminator help flag remains untouched",
      argv: ["node", "carapace", "backup", "help", "--", "--help"],
      expected: ["node", "carapace", "backup", "help", "--", "--help"],
    },
  ])("normalizes generated help commands: $name", ({ argv, expected }) => {
    expect(normalizeGeneratedHelpCommandArgv(argv)).toEqual(expected);
  });

  it.each([
    {
      name: "root help target",
      argv: ["node", "carapace", "help", "plugins"],
      expected: ["node", "carapace", "plugins", "--help"],
    },
    {
      name: "root help target with help flag",
      argv: ["node", "carapace", "help", "plugins", "--help"],
      expected: ["node", "carapace", "plugins", "--help"],
    },
    {
      name: "root option before help target",
      argv: ["node", "carapace", "--profile", "work", "help", "memory"],
      expected: ["node", "carapace", "--profile", "work", "memory", "--help"],
    },
    {
      name: "bare root help remains untouched",
      argv: ["node", "carapace", "help"],
      expected: ["node", "carapace", "help"],
    },
    {
      name: "root help self-help remains untouched",
      argv: ["node", "carapace", "help", "--help"],
      expected: ["node", "carapace", "help", "--help"],
    },
    {
      name: "nested root help target",
      argv: ["node", "carapace", "help", "plugins", "list"],
      expected: ["node", "carapace", "plugins", "list", "--help"],
    },
    {
      name: "nested root help target with help flag",
      argv: ["node", "carapace", "help", "plugins", "list", "--help"],
      expected: ["node", "carapace", "plugins", "list", "--help"],
    },
    {
      name: "nested root help target with trailing root option",
      argv: ["node", "carapace", "help", "memory", "status", "--no-color"],
      expected: ["node", "carapace", "--no-color", "memory", "status", "--help"],
    },
  ])("normalizes root help targets: $name", ({ argv, expected }) => {
    expect(normalizeRootHelpTargetArgv(argv)).toEqual(expected);
  });

  it.each([
    {
      name: "subcommand trailing no-color",
      argv: ["node", "carapace", "doctor", "--no-color", "--post-upgrade", "--json"],
      expected: ["node", "carapace", "--no-color", "doctor", "--post-upgrade", "--json"],
    },
    {
      name: "keeps existing root options first",
      argv: ["node", "carapace", "--profile", "work", "doctor", "--no-color", "--lint", "--json"],
      expected: [
        "node",
        "carapace",
        "--profile",
        "work",
        "--no-color",
        "doctor",
        "--lint",
        "--json",
      ],
    },
    {
      name: "keeps no-color after possible command option value",
      argv: ["node", "carapace", "doctor", "--lint", "--json", "--no-color"],
      expected: ["node", "carapace", "doctor", "--lint", "--json", "--no-color"],
    },
    {
      name: "flag terminator leaves no-color positional",
      argv: ["node", "carapace", "doctor", "--", "--no-color"],
      expected: ["node", "carapace", "doctor", "--", "--no-color"],
    },
    {
      name: "command option value remains literal",
      argv: ["node", "carapace", "agent", "--message", "--no-color"],
      expected: ["node", "carapace", "agent", "--message", "--no-color"],
    },
    {
      name: "assigned command option value does not block no-color",
      argv: ["node", "carapace", "agent", "--message=hello", "--no-color"],
      expected: ["node", "carapace", "--no-color", "agent", "--message=hello"],
    },
  ])("normalizes root --no-color before command parsing: $name", ({ argv, expected }) => {
    expect(normalizeRootNoColorArgv(argv)).toEqual(expected);
  });

  it("allows final command metadata to lift no-color after boolean command flags", () => {
    const argv = ["node", "carapace", "doctor", "--lint", "--json", "--no-color"];

    expect(
      normalizeRootNoColorArgv(argv, {
        shouldPreserveNoColor: ({ remainingArgs, noColorIndex }) =>
          remainingArgs[noColorIndex - 1] === "--message",
      }),
    ).toEqual(["node", "carapace", "--no-color", "doctor", "--lint", "--json"]);
  });

  it.each([
    {
      name: "subcommand trailing log-level",
      argv: ["node", "carapace", "doctor", "--log-level", "debug", "--json"],
      expected: ["node", "carapace", "--log-level", "debug", "doctor", "--json"],
    },
    {
      name: "subcommand trailing log-level equals form",
      argv: ["node", "carapace", "doctor", "--log-level=trace", "--json"],
      expected: ["node", "carapace", "--log-level=trace", "doctor", "--json"],
    },
    {
      name: "keeps existing root options first",
      argv: ["node", "carapace", "--profile", "work", "doctor", "--log-level", "debug"],
      expected: ["node", "carapace", "--profile", "work", "--log-level", "debug", "doctor"],
    },
    {
      name: "keeps log-level after possible command option value",
      argv: ["node", "carapace", "agent", "--message", "--log-level", "debug"],
      expected: ["node", "carapace", "agent", "--message", "--log-level", "debug"],
    },
    {
      name: "flag terminator leaves log-level positional",
      argv: ["node", "carapace", "nodes", "run", "--", "--log-level", "debug"],
      expected: ["node", "carapace", "nodes", "run", "--", "--log-level", "debug"],
    },
    {
      name: "missing value remains command scoped",
      argv: ["node", "carapace", "doctor", "--log-level", "--json"],
      expected: ["node", "carapace", "doctor", "--log-level", "--json"],
    },
  ])("normalizes root --log-level before command parsing: $name", ({ argv, expected }) => {
    expect(normalizeRootLogLevelArgv(argv)).toEqual(expected);
  });

  it("allows final command metadata to lift log-level after boolean command flags", () => {
    const argv = ["node", "carapace", "doctor", "--lint", "--json", "--log-level", "debug"];

    expect(
      normalizeRootLogLevelArgv(argv, {
        shouldPreserveLogLevel: ({ remainingArgs, logLevelIndex }) =>
          remainingArgs[logLevelIndex - 1] === "--message",
      }),
    ).toEqual(["node", "carapace", "--log-level", "debug", "doctor", "--lint", "--json"]);
  });

  it("preserves log-level when final command metadata owns the option", () => {
    const argv = ["node", "carapace", "plugin-cmd", "--log-level", "debug"];

    expect(
      normalizeRootLogLevelArgv(argv, {
        shouldPreserveLogLevel: ({ remainingArgs, logLevelIndex }) =>
          remainingArgs[logLevelIndex] === "--log-level",
      }),
    ).toEqual(argv);
  });

  it.each([
    {
      name: "root help command",
      argv: ["node", "carapace", "help"],
      expected: true,
    },
    {
      name: "root help command with target",
      argv: ["node", "carapace", "help", "matrix"],
      expected: true,
    },
    {
      name: "nested help command",
      argv: ["node", "carapace", "matrix", "encryption", "help"],
      expected: true,
    },
    {
      name: "known subcommand root help command",
      argv: ["node", "carapace", "config", "help"],
      expected: true,
    },
    {
      name: "known leaf command positional help",
      argv: ["node", "carapace", "docs", "help"],
      expected: false,
    },
    {
      name: "known subcommand leaf positional help",
      argv: ["node", "carapace", "config", "set", "some.path", "help"],
      expected: false,
    },
    {
      name: "unknown plugin command help",
      argv: ["node", "carapace", "external-plugin", "tools", "help"],
      expected: true,
    },
    {
      name: "help flag",
      argv: ["node", "carapace", "matrix", "encryption", "--help"],
      expected: true,
    },
    {
      name: "help as option value",
      argv: ["node", "carapace", "agent", "--message", "help"],
      expected: false,
    },
    {
      name: "help after terminator",
      argv: ["node", "carapace", "nodes", "invoke", "--", "help"],
      expected: false,
    },
    {
      name: "implicit root help command after terminator",
      argv: ["node", "carapace", "--", "help", "config"],
      expected: true,
    },
    {
      name: "implicit parent help command after terminator",
      argv: ["node", "carapace", "config", "--", "help"],
      expected: true,
    },
    {
      name: "literal root help-looking command",
      argv: ["node", "carapace", "--", "--help"],
      expected: false,
    },
    {
      name: "literal parent help-looking command",
      argv: ["node", "carapace", "--", "config", "--help"],
      expected: false,
    },
    {
      name: "help flag after terminator",
      argv: ["node", "carapace", "nodes", "invoke", "--", "--help"],
      expected: false,
    },
    {
      name: "version flag after terminator",
      argv: ["node", "carapace", "nodes", "invoke", "--", "--version"],
      expected: false,
    },
    {
      name: "root version flag",
      argv: ["node", "carapace", "--version"],
      expected: true,
    },
    {
      name: "root short version flag",
      argv: ["node", "carapace", "-V"],
      expected: true,
    },
    {
      name: "root version alias after profile",
      argv: ["node", "carapace", "--profile", "work", "-v"],
      expected: true,
    },
    {
      name: "root version flag after profile",
      argv: ["node", "carapace", "--profile", "work", "--version"],
      expected: true,
    },
    {
      name: "version-pinned skill install",
      argv: ["node", "carapace", "skills", "install", "@owner/weather", "--version", "1.2.3"],
      expected: false,
    },
    {
      name: "version-pinned skill verification",
      argv: ["node", "carapace", "skills", "verify", "@owner/weather", "--version", "1.2.3"],
      expected: false,
    },
    {
      name: "equals-form version-pinned skill install",
      argv: ["node", "carapace", "skills", "install", "@owner/weather", "--version=1.2.3"],
      expected: false,
    },
    {
      name: "profiled version-pinned skill verification",
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
      expected: false,
    },
    {
      name: "help for a version-pinned skill command",
      argv: [
        "node",
        "carapace",
        "skills",
        "verify",
        "@owner/weather",
        "--version",
        "1.2.3",
        "--help",
      ],
      expected: true,
    },
    {
      name: "unknown root option does not turn version into root help",
      argv: ["node", "carapace", "--unknown", "--version"],
      expected: false,
    },
  ])("detects help/version invocations: $name", ({ argv, expected }) => {
    expect(isHelpOrVersionInvocation(argv)).toBe(expected);
  });

  it.each([
    { path: ["skills", "verify"], option: "tag" },
    { path: ["skills", "verify"], option: "version" },
    { path: ["models", "list"], option: "provider" },
    { path: ["agent"], option: "message" },
  ])("keeps actual help after a root-looking $option value on $path", async ({ path, option }) => {
    const program = new Command()
      .name("carapace")
      .enablePositionalOptions()
      .option("--log-level <level>")
      .exitOverride();
    program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
    const leaf = path.reduce((parent, name) => parent.command(name), program);
    leaf.option(`--${option} <value>`);
    const argv = ["node", "carapace", ...path, `--${option}`, "--log-level", "--help"];

    await expect(program.parseAsync(argv)).rejects.toMatchObject({
      code: "commander.helpDisplayed",
      exitCode: 0,
    });
    expect(leaf.opts()[option]).toBe("--log-level");
    expect(isHelpOrVersionInvocation(argv)).toBe(true);
  });

  it.each([
    {
      name: "root --version",
      argv: ["node", "carapace", "--version"],
      expected: true,
    },
    {
      name: "root -V",
      argv: ["node", "carapace", "-V"],
      expected: true,
    },
    {
      name: "root -v alias with profile",
      argv: ["node", "carapace", "--profile", "work", "-v"],
      expected: true,
    },
    {
      name: "subcommand version flag",
      argv: ["node", "carapace", "status", "--version"],
      expected: false,
    },
    {
      name: "unknown root flag with version",
      argv: ["node", "carapace", "--unknown", "--version"],
      expected: false,
    },
  ])("detects root-only version invocations: $name", ({ argv, expected }) => {
    expect(isRootVersionInvocation(argv)).toBe(expected);
  });

  it.each([
    {
      name: "root --help",
      argv: ["node", "carapace", "--help"],
      expected: true,
    },
    {
      name: "root -h",
      argv: ["node", "carapace", "-h"],
      expected: true,
    },
    {
      name: "root --help with profile",
      argv: ["node", "carapace", "--profile", "work", "--help"],
      expected: true,
    },
    {
      name: "subcommand --help",
      argv: ["node", "carapace", "status", "--help"],
      expected: false,
    },
    {
      name: "help before subcommand token",
      argv: ["node", "carapace", "--help", "status"],
      expected: false,
    },
    {
      name: "help after -- terminator",
      argv: ["node", "carapace", "nodes", "invoke", "--", "device.status", "--help"],
      expected: false,
    },
    {
      name: "unknown root flag before help",
      argv: ["node", "carapace", "--unknown", "--help"],
      expected: false,
    },
    {
      name: "unknown root flag after help",
      argv: ["node", "carapace", "--help", "--unknown"],
      expected: false,
    },
  ])("detects root-only help invocations: $name", ({ argv, expected }) => {
    expect(isRootHelpInvocation(argv)).toBe(expected);
  });

  it.each([
    {
      name: "single command with trailing flag",
      argv: ["node", "carapace", "status", "--json"],
      expected: ["status"],
    },
    {
      name: "two-part command",
      argv: ["node", "carapace", "agents", "list"],
      expected: ["agents", "list"],
    },
    {
      name: "terminator cuts parsing",
      argv: ["node", "carapace", "status", "--", "ignored"],
      expected: ["status"],
    },
  ])("extracts command path: $name", ({ argv, expected }) => {
    expect(getCommandPathWithRootOptions(argv, 2)).toEqual(expected);
  });

  it("extracts command path while skipping known root option values", () => {
    expect(
      getCommandPathWithRootOptions(
        [
          "node",
          "carapace",
          "--profile",
          "work",
          "--container",
          "demo",
          "--no-color",
          "config",
          "validate",
        ],
        2,
      ),
    ).toEqual(["config", "validate"]);
  });

  it("limits simple help fast paths to root options, a command, and help", () => {
    const commands = new Set(["setup"]);
    expect(
      isSimpleCommandHelpInvocation(
        ["node", "carapace", "--profile", "work", "setup", "--help"],
        commands,
      ),
    ).toBe(true);
    expect(
      isSimpleCommandHelpInvocation(
        ["node", "carapace", "setup", "--workspace", "--help"],
        commands,
      ),
    ).toBe(false);
    expect(
      isSimpleCommandHelpInvocation(
        ["node", "carapace", "setup", "--profile", "work", "--help"],
        commands,
      ),
    ).toBe(false);
    expect(isSimpleCommandHelpInvocation(["node", "carapace", "--help", "setup"], commands)).toBe(
      false,
    );
  });

  it("extracts routed config get positionals with interleaved root options", () => {
    expect(
      getCommandPositionalsWithRootOptions(
        ["node", "carapace", "config", "get", "--log-level", "debug", "update.channel", "--json"],
        {
          commandPath: ["config", "get"],
          booleanFlags: ["--json"],
        },
      ),
    ).toEqual(["update.channel"]);
  });

  it("extracts routed config unset positionals with interleaved root options", () => {
    expect(
      getCommandPositionalsWithRootOptions(
        ["node", "carapace", "config", "unset", "--profile", "work", "update.channel"],
        {
          commandPath: ["config", "unset"],
        },
      ),
    ).toEqual(["update.channel"]);
  });

  it("returns null when routed command sees unknown options", () => {
    expect(
      getCommandPositionalsWithRootOptions(
        ["node", "carapace", "config", "get", "--mystery", "value", "update.channel"],
        {
          commandPath: ["config", "get"],
          booleanFlags: ["--json"],
        },
      ),
    ).toBeNull();
  });

  it.each([
    {
      name: "returns first command token",
      argv: ["node", "carapace", "agents", "list"],
      expected: "agents",
    },
    {
      name: "returns null when no command exists",
      argv: ["node", "carapace"],
      expected: null,
    },
    {
      name: "skips known root option values",
      argv: ["node", "carapace", "--log-level", "debug", "status"],
      expected: "status",
    },
  ])("returns primary command: $name", ({ argv, expected }) => {
    expect(getPrimaryCommand(argv)).toBe(expected);
  });

  it.each([
    {
      name: "detects flag before terminator",
      argv: ["node", "carapace", "status", "--json"],
      flag: "--json",
      expected: true,
    },
    {
      name: "ignores flag after terminator",
      argv: ["node", "carapace", "--", "--json"],
      flag: "--json",
      expected: false,
    },
  ])("parses boolean flags: $name", ({ argv, flag, expected }) => {
    expect(hasFlag(argv, flag)).toBe(expected);
  });

  it.each([
    {
      name: "value in next token",
      argv: ["node", "carapace", "status", "--timeout", "5000"],
      expected: "5000",
    },
    {
      name: "value in equals form",
      argv: ["node", "carapace", "status", "--timeout=2500"],
      expected: "2500",
    },
    {
      name: "missing value",
      argv: ["node", "carapace", "status", "--timeout"],
      expected: null,
    },
    {
      name: "next token is another flag",
      argv: ["node", "carapace", "status", "--timeout", "--json"],
      expected: null,
    },
    {
      name: "flag appears after terminator",
      argv: ["node", "carapace", "--", "--timeout=99"],
      expected: undefined,
    },
    {
      name: "repeated flag uses final value",
      argv: ["node", "carapace", "status", "--timeout", "100", "--timeout=200"],
      expected: "200",
    },
    {
      name: "missing repeated value remains invalid",
      argv: ["node", "carapace", "status", "--timeout", "--timeout", "200"],
      expected: null,
    },
  ])("extracts flag values: $name", ({ argv, expected }) => {
    expect(getFlagValue(argv, "--timeout")).toBe(expected);
  });

  it("parses verbose flags", () => {
    expect(getVerboseFlag(["node", "carapace", "status", "--verbose"])).toBe(true);
    expect(getVerboseFlag(["node", "carapace", "status", "--debug"])).toBe(false);
    expect(getVerboseFlag(["node", "carapace", "status", "--debug"], { includeDebug: true })).toBe(
      true,
    );
  });

  it.each([
    {
      name: "missing flag",
      argv: ["node", "carapace", "status"],
      expected: undefined,
    },
    {
      name: "missing value",
      argv: ["node", "carapace", "status", "--timeout"],
      expected: null,
    },
    {
      name: "valid positive integer",
      argv: ["node", "carapace", "status", "--timeout", "5000"],
      expected: 5000,
    },
    {
      name: "valid signed decimal positive integer",
      argv: ["node", "carapace", "status", "--timeout", "+5000"],
      expected: 5000,
    },
    {
      name: "invalid integer",
      argv: ["node", "carapace", "status", "--timeout", "nope"],
      expected: null,
    },
    {
      name: "non-decimal integer",
      argv: ["node", "carapace", "status", "--timeout", "0x10"],
      expected: null,
    },
    {
      name: "partial integer",
      argv: ["node", "carapace", "status", "--timeout", "5s"],
      expected: null,
    },
    {
      name: "zero",
      argv: ["node", "carapace", "status", "--timeout", "0"],
      expected: null,
    },
    {
      name: "negative integer",
      argv: ["node", "carapace", "status", "--timeout", "-5"],
      expected: null,
    },
    {
      name: "repeated value uses final valid integer",
      argv: ["node", "carapace", "status", "--timeout", "nope", "--timeout", "5000"],
      expected: 5000,
    },
    {
      name: "repeated value rejects final invalid integer",
      argv: ["node", "carapace", "status", "--timeout", "5000", "--timeout", "nope"],
      expected: null,
    },
  ])("parses positive integer flag values: $name", ({ argv, expected }) => {
    expect(getPositiveIntFlagValue(argv, "--timeout")).toBe(expected);
  });

  it.each([
    {
      name: "keeps plain node argv",
      rawArgs: ["node", "carapace", "status"],
      expected: ["node", "carapace", "status"],
    },
    {
      name: "keeps version-suffixed node binary",
      rawArgs: ["node-22", "carapace", "status"],
      expected: ["node-22", "carapace", "status"],
    },
    {
      name: "keeps windows versioned node exe",
      rawArgs: ["node-22.2.0.exe", "carapace", "status"],
      expected: ["node-22.2.0.exe", "carapace", "status"],
    },
    {
      name: "keeps dotted node binary",
      rawArgs: ["node-22.2", "carapace", "status"],
      expected: ["node-22.2", "carapace", "status"],
    },
    {
      name: "keeps dotted node exe",
      rawArgs: ["node-22.2.exe", "carapace", "status"],
      expected: ["node-22.2.exe", "carapace", "status"],
    },
    {
      name: "keeps absolute versioned node path",
      rawArgs: ["/usr/bin/node-22.2.0", "carapace", "status"],
      expected: ["/usr/bin/node-22.2.0", "carapace", "status"],
    },
    {
      name: "keeps node24 shorthand",
      rawArgs: ["node24", "carapace", "status"],
      expected: ["node24", "carapace", "status"],
    },
    {
      name: "keeps absolute node24 shorthand",
      rawArgs: ["/usr/bin/node24", "carapace", "status"],
      expected: ["/usr/bin/node24", "carapace", "status"],
    },
    {
      name: "keeps windows node24 exe",
      rawArgs: ["node24.exe", "carapace", "status"],
      expected: ["node24.exe", "carapace", "status"],
    },
    {
      name: "keeps nodejs binary",
      rawArgs: ["nodejs", "carapace", "status"],
      expected: ["nodejs", "carapace", "status"],
    },
    {
      name: "prefixes fallback when first arg is not a node launcher",
      rawArgs: ["node-dev", "carapace", "status"],
      expected: ["node", "carapace", "node-dev", "carapace", "status"],
    },
    {
      name: "prefixes fallback when raw args start at program name",
      rawArgs: ["carapace", "status"],
      expected: ["node", "carapace", "status"],
    },
    {
      name: "keeps bun execution argv",
      rawArgs: ["bun", "src/entry.ts", "status"],
      expected: ["bun", "src/entry.ts", "status"],
    },
  ] as const)("builds parse argv from raw args: $name", ({ rawArgs, expected }) => {
    const parsed = buildParseArgv([...rawArgs]);
    expect(parsed).toEqual([...expected]);
  });
});

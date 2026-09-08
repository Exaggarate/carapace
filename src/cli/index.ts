#!/usr/bin/env node
// carapace CLI. M0 commands: gateway | doctor | models | version | help.
// No argument-parsing dependency — the surface is four words.

import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  carapaceHome,
  ConfigError,
  describeSecretValue,
  loadConfig,
  resolveSecret,
  type CarapaceConfig,
  type LoadedConfig,
} from "../config.js";
import { ApiChannel } from "../gateway/channels/api.js";
import { DiscordChannel, probeDiscordToken } from "../gateway/channels/discord.js";
import { TelegramChannel } from "../gateway/channels/telegram.js";
import { customThemeFilePath, validateThemeCss } from "../gateway/dashboard.js";
import { scanPlugins } from "../gateway/plugins.js";
import { buildRuntime } from "../gateway/runtime.js";
import { startGatewayServer } from "../gateway/server.js";
import { createBuiltinToolRegistry } from "../core/tools/builtins/index.js";
import { fileToolsDir, loadFileToolDefs } from "../core/tools/custom.js";
import { CarapaceStore } from "../storage/sqlite.js";
import { VERSION } from "../version.js";

const USAGE = `carapace v${VERSION} — independent multi-channel agent gateway

Usage:
  carapace gateway    start the gateway (LLM + tools + channels + HTTP server)
  carapace doctor     check node, config, directories, storage, llm, tools, channels
  carapace models     show the configured model/provider
  carapace version    print the version
  carapace help       show this help

Config: ~/.carapace/config.json (created with defaults on first run)
Env:    CARAPACE_* overrides (see docs/index.md)
`;

interface CheckResult {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}

function loadOrReport(): LoadedConfig | null {
  try {
    return loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error("config error:");
      for (const issue of error.issues) console.error(`  - ${issue}`);
      return null;
    }
    throw error;
  }
}

async function commandGateway(): Promise<number> {
  const loaded = loadOrReport();
  if (loaded === null) return 1;
  if (loaded.createdDefaults) {
    console.log(`first run: wrote default config to ${loaded.configPath}`);
  }
  for (const warning of loaded.warnings) console.warn(`warning: ${warning}`);

  const runtime = buildRuntime({ config: loaded.config });
  const handle = await startGatewayServer({
    host: loaded.config.gateway.host,
    port: loaded.config.gateway.port,
    routes: runtime.routes,
  });

  console.log(`🐢 carapace v${VERSION}`);
  console.log(`   gateway → http://${handle.host}:${handle.port} (health: GET /health)`);
  console.log(`   ui      → http://${handle.host}:${handle.port}/ui (theme: ${loaded.config.ui.theme})`);
  console.log(`   storage → ${loaded.config.storage.path}`);
  console.log(`   llm     → ${loaded.config.llm.model} @ ${loaded.config.llm.baseURL}`);
  if (resolveSecret(loaded.config.llm.apiKey) === null) {
    console.warn("   llm     → API key unresolved — agent turns will fail until llm.apiKey is set");
  }
  for (const channel of runtime.channels) {
    if (!channel.isConfigured()) {
      console.log(`   channel → ${channel.name}: not configured, skipped`);
      continue;
    }
    try {
      await channel.start();
      console.log(`   channel → ${channel.name}: running`);
    } catch (error) {
      console.error(`   channel → ${channel.name}: failed to start (${(error as Error).message})`);
    }
  }
  console.log("   ready — press ctrl+c to stop");

  let shuttingDown = false;
  /** Bounded patience for in-flight agent turns before the process exits anyway. */
  const SHUTDOWN_GRACE_MS = 15_000;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\nreceived ${signal}, shutting down…`);
    void (async () => {
      for (const channel of runtime.channels) {
        try {
          await channel.stop();
        } catch {
          // keep shutting down regardless
        }
      }
      // Give in-flight turns a bounded chance to finish; anything queued behind
      // them is redelivered on the next start (offsets only confirm processed work).
      const drained = await runtime.waitUntilIdle(SHUTDOWN_GRACE_MS);
      if (!drained) console.warn("shutdown grace elapsed with turns still active — closing anyway");
      await handle.stop();
      runtime.close();
      console.log("shutdown complete");
      process.exit(0);
    })();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  return 0;
}

function nodeMajorVersion(): number {
  const raw = process.version.replace(/^v/, "").split(".")[0] ?? "0";
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) ? parsed : 0;
}

async function commandDoctor(): Promise<number> {
  const results: CheckResult[] = [];

  const major = nodeMajorVersion();
  results.push(
    major >= 22
      ? { name: "node", status: "ok", detail: `${process.version} (carapace needs >= 22)` }
      : { name: "node", status: "fail", detail: `${process.version} — carapace needs Node >= 22 (node:sqlite, fetch)` },
  );

  let config: CarapaceConfig | null = null;
  try {
    const loaded = loadConfig();
    config = loaded.config;
    results.push({
      name: "config",
      status: "ok",
      detail: `${loaded.configPath}${loaded.createdDefaults ? " (defaults created this run)" : ""}`,
    });
    for (const warning of loaded.warnings) {
      results.push({ name: "config", status: "warn", detail: warning });
    }
  } catch (error) {
    const detail = error instanceof ConfigError ? error.issues.join(" | ") : (error as Error).message;
    results.push({ name: "config", status: "fail", detail });
  }

  const home = carapaceHome();
  try {
    mkdirSync(home, { recursive: true });
    const probe = join(home, ".doctor-probe");
    writeFileSync(probe, "ok", "utf8");
    unlinkSync(probe);
    results.push({ name: "dirs:config-home", status: "ok", detail: `${home} is writable` });
  } catch (error) {
    results.push({ name: "dirs:config-home", status: "fail", detail: `${home}: ${(error as Error).message}` });
  }

  if (config !== null) {
    try {
      mkdirSync(dirname(config.storage.path), { recursive: true });
      results.push({
        name: "dirs:storage",
        status: "ok",
        detail: `${dirname(config.storage.path)} is writable`,
      });
    } catch (error) {
      results.push({
        name: "dirs:storage",
        status: "fail",
        detail: `${dirname(config.storage.path)}: ${(error as Error).message}`,
      });
    }
  }

  // Storage engine probe on a throwaway db in the OS tmpdir — never touches the real one.
  const probeDb = join(tmpdir(), `carapace-doctor-${process.pid}.db`);
  try {
    const store = new CarapaceStore(probeDb);
    store.createSession("doctor-probe", "doctor");
    store.appendMessage("doctor-probe", "user", "doctor smoke test");
    const session = store.getSession("doctor-probe");
    const messages = store.listMessages("doctor-probe");
    store.close();
    const healthy = session !== null && messages.length === 1;
    results.push(
      healthy
        ? { name: "storage", status: "ok", detail: "node:sqlite sessions+messages round-trip passed" }
        : { name: "storage", status: "fail", detail: "node:sqlite round-trip returned unexpected data" },
    );
  } catch (error) {
    results.push({
      name: "storage",
      status: "fail",
      detail: `node:sqlite probe failed: ${(error as Error).message}`,
    });
  } finally {
    try {
      unlinkSync(probeDb);
    } catch {
      // best-effort cleanup
    }
  }

  if (config !== null) {
    const telegram = new TelegramChannel(config);
    const api = new ApiChannel(config);
    results.push({
      name: "channel:telegram",
      status: config.channels.telegram.enabled
        ? telegram.isConfigured()
          ? "ok"
          : "warn"
        : "ok",
      detail: telegram.describe(),
    });
    results.push({
      name: "channel:api",
      status: config.channels.api.enabled ? "ok" : "warn",
      detail: api.describe(),
    });
    const discord = new DiscordChannel(config);
    results.push({
      name: "channel:discord",
      status: config.channels.discord.enabled
        ? discord.isConfigured()
          ? "ok"
          : "warn"
        : "ok",
      detail: discord.describe(),
    });
    // Gateway reachability probe — only when enabled + token present; a disabled
    // channel must never touch the network. A rejected token (401) FAILs (it is a
    // config problem), unreachable gateways only WARN (network, not config).
    if (config.channels.discord.enabled && discord.isConfigured()) {
      const token = resolveSecret(config.channels.discord.botToken) ?? "";
      const probe = await probeDiscordToken(token);
      results.push({
        name: "channel:discord-gateway",
        status: probe.ok ? "ok" : probe.fatal ? "fail" : "warn",
        detail: probe.detail,
      });
    }
    if (!config.channels.telegram.enabled && !config.channels.api.enabled && !config.channels.discord.enabled) {
      results.push({
        name: "channels",
        status: "warn",
        detail: "no channel enabled — the gateway will only serve GET /health",
      });
    }

    if (config.agent.announceTarget !== null) {
      const target = config.agent.announceTarget;
      const pushable = target.channel === "telegram" || target.channel === "discord";
      results.push({
        name: "agent:announceTarget",
        status: pushable ? "ok" : "warn",
        detail:
          `completion notices route to ${target.channel}:${target.chatId}` +
          (pushable
            ? ""
            : " — that channel replies in-band and cannot receive pushes; replies will stay in the origin chat"),
      });
    }

    if (config.senders.length > 0) {
      const toolNames = createBuiltinToolRegistry(config).names();
      const unknown = config.senders.flatMap((route, index) =>
        (route.allowTools ?? [])
          .filter((name) => !toolNames.includes(name))
          .map((name) => `senders[${index}] tool "${name}" not in the registry`),
      );
      results.push({
        name: "routing:senders",
        status: unknown.length > 0 ? "warn" : "ok",
        detail:
          `${config.senders.length} sender route(s): ` +
          config.senders
            .map((route) => {
              const overrides = [
                route.allowTools !== undefined ? `${route.allowTools.length} tool(s)` : null,
                route.model !== undefined ? `model=${route.model}` : null,
              ].filter(Boolean);
              return `${route.channel ?? "*"}:${route.match} → ${overrides.join(", ") || "no overrides"}`;
            })
            .join("; ") + (unknown.length > 0 ? ` — ${unknown.join("; ")}` : ""),
      });
    }

    const llmKeyResolved = resolveSecret(config.llm.apiKey) !== null;
    results.push({
      name: "llm",
      status: llmKeyResolved ? "ok" : "warn",
      detail: `baseURL=${config.llm.baseURL}, model=${config.llm.model}, apiKey=${describeSecretValue(
        config.llm.apiKey,
      )}${llmKeyResolved ? "" : " (unresolved — agent turns will fail until it is set)"}`,
    });

    // Dashboard theming (#28300): presets are always valid; "custom" needs a readable,
    // CSS-shaped theme file — an unreadable or invalid one fails the check.
    const themeName = config.ui?.theme ?? "dark";
    if (themeName === "custom") {
      const themePath = customThemeFilePath(config);
      try {
        const css = readFileSync(themePath, "utf8");
        const verdict = validateThemeCss(css);
        results.push(
          verdict.ok
            ? { name: "ui:theme", status: "ok", detail: `custom theme ${themePath} (${css.length} bytes)` }
            : { name: "ui:theme", status: "fail", detail: `${themePath}: ${verdict.reason}` },
        );
      } catch (error) {
        results.push({
          name: "ui:theme",
          status: "fail",
          detail: `${themePath}: ${(error as Error).message}`,
        });
      }
    } else {
      results.push({
        name: "ui:theme",
        status: "ok",
        detail: `theme=${themeName} (built-in preset; ui.theme="custom" loads a stylesheet from ui.themeFile)`,
      });
    }

    // Plugin-UI foundation (#66944): loaded plugins + manifest problems as warnings.
    const pluginScan = scanPlugins(config);
    const pluginNames = pluginScan.plugins.map((plugin) => `${plugin.manifest.name} (${plugin.source})`);
    results.push({
      name: "ui:plugins",
      status: pluginScan.issues.length > 0 ? "warn" : "ok",
      detail:
        `${pluginScan.plugins.length} plugin(s): ${pluginNames.join(", ") || "none"}` +
        (pluginScan.issues.length > 0 ? ` — ${pluginScan.issues.join("; ")}` : ""),
    });

    try {
      for (const root of config.tools.allowedRoots) mkdirSync(root, { recursive: true });
      results.push({
        name: "tools",
        status: "ok",
        detail: `allowedRoots=${config.tools.allowedRoots.join(", ")}, exec timeout=${
          config.tools.exec.timeoutMs
        }ms, denylist=${config.tools.exec.denylist.length} pattern(s)`,
      });
    } catch (error) {
      results.push({
        name: "tools",
        status: "warn",
        detail: `allowedRoots not creatable: ${(error as Error).message}`,
      });
    }

    // File-defined tools are validated read-only here — doctor never runs setup hooks.
    const fileTools = loadFileToolDefs(fileToolsDir());
    results.push({
      name: "tools:custom",
      status: fileTools.issues.length > 0 ? "warn" : "ok",
      detail:
        `${fileTools.defs.length} file-defined tool(s) in ${fileToolsDir()}` +
        (fileTools.issues.length > 0 ? ` — ${fileTools.issues.join("; ")}` : ""),
    });
  }

  const failed = results.filter((r) => r.status === "fail");
  const warned = results.filter((r) => r.status === "warn");
  const passed = results.length - failed.length - warned.length;

  console.log(`carapace doctor — ${process.version} on ${process.platform}`);
  for (const result of results) {
    const mark = result.status === "ok" ? "[ ok ]" : result.status === "warn" ? "[warn]" : "[FAIL]";
    console.log(`${mark} ${result.name}: ${result.detail}`);
  }
  console.log(`\nsummary: ${passed} ok, ${warned.length} warning(s), ${failed.length} failure(s)`);
  const healthy = failed.length === 0;
  console.log(healthy ? "verdict: healthy" : "verdict: problems found — fix the [FAIL] items above");
  return healthy ? 0 : 1;
}

function commandModels(): number {
  const loaded = loadOrReport();
  if (loaded === null) return 1;
  const { config } = loaded;
  console.log("model providers:");
  console.log("  - openai-compatible   POST {llm.baseURL}/chat/completions   implemented (M1)");
  console.log("  - anthropic           /v1/messages                          planned M2");
  console.log("  - ollama native       /api/chat                             planned M2");
  console.log("");
  console.log(
    `configured: ${config.llm.model} @ ${config.llm.baseURL} (apiKey: ${describeSecretValue(config.llm.apiKey)})`,
  );
  console.log("any OpenAI-compatible endpoint works: OpenAI, Ollama (/v1), vLLM, LM Studio, OpenRouter, …");
  return 0;
}

function commandVersion(): number {
  console.log(`carapace ${VERSION} (node ${process.version})`);
  return 0;
}

export async function main(argv: string[]): Promise<number> {
  const command = argv[0] ?? "";
  switch (command) {
    case "gateway":
      return await commandGateway();
    case "doctor":
      return await commandDoctor();
    case "models":
      return commandModels();
    case "version":
    case "--version":
      return commandVersion();
    case "help":
    case "--help":
    case "-h":
      console.log(USAGE);
      return 0;
    default:
      console.error(`unknown command: "${command}"`);
      console.log(USAGE);
      return 2;
  }
}

if ((process.argv[1] ?? "").endsWith("cli/index.js")) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error(`carapace: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
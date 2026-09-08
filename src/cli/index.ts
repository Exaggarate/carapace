#!/usr/bin/env node
// carapace CLI. M0 commands: gateway | doctor | models | version | help.
// No argument-parsing dependency — the surface is four words.

import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
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
import { TelegramChannel } from "../gateway/channels/telegram.js";
import { buildRuntime } from "../gateway/runtime.js";
import { startGatewayServer } from "../gateway/server.js";
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
      await handle.stop();
      runtime.close();
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
    if (!config.channels.telegram.enabled && !config.channels.api.enabled) {
      results.push({
        name: "channels",
        status: "warn",
        detail: "no channel enabled — the gateway will only serve GET /health",
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
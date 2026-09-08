// Web dashboard + theme system (#28300): GET /ui serves a zero-dependency single-page
// dashboard over the gateway's own HTTP surface. Data flows through /api/v1 endpoints
// under the same bearer-auth model as the API channel; the page shell itself is static
// HTML and carries no data, so it stays open when a token is configured.
// Themes are CSS-variable presets selected by ui.theme (default dark); theme="custom"
// inlines the ui.themeFile stylesheet (default ~/.carapace/theme.css).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { carapaceHome, expandTilde, type CarapaceConfig, type SecretValue } from "../config.js";
import type { CarapaceStore } from "../storage/sqlite.js";
import { respondUnauthorized, readJsonBody, requestAuthorized } from "./channels/api.js";
import type { ChannelAdapter, SessionDirectory } from "./channels/types.js";
import { respondJson, type RouteTable } from "./server.js";
import { VERSION } from "../version.js";

/** Built-in theme presets; a preset is one :root block of CSS custom properties. */
const THEME_PRESETS = {
  dark: `:root{color-scheme:dark;--bg:#0d1117;--panel:#151b23;--panel2:#1b2330;--border:#2a3341;--text:#e6edf3;--muted:#92a3b8;--accent:#ff5c35;--accent-soft:rgba(255,92,53,.14);--ok:#3fb950;--ok-soft:rgba(63,185,80,.15);--warn:#d29922;--err:#f85149;--err-soft:rgba(248,81,73,.15)}`,
  light: `:root{color-scheme:light;--bg:#f6f8fa;--panel:#ffffff;--panel2:#eef1f5;--border:#d0d7de;--text:#1f2328;--muted:#59636e;--accent:#d93a12;--accent-soft:rgba(217,58,18,.12);--ok:#1a7f37;--ok-soft:rgba(26,127,55,.14);--warn:#9a6700;--err:#cf222e;--err-soft:rgba(207,34,46,.12)}`,
  "lobster-red": `:root{color-scheme:dark;--bg:#160709;--panel:#240d10;--panel2:#2e1216;--border:#4a1d23;--text:#ffe9e6;--muted:#d99c95;--accent:#ff3b30;--accent-soft:rgba(255,59,48,.18);--ok:#4ade80;--ok-soft:rgba(74,222,128,.14);--warn:#fbbf24;--err:#ff6b6b;--err-soft:rgba(255,107,107,.16)}`,
  "carapace-amber": `:root{color-scheme:dark;--bg:#151106;--panel:#211b0d;--panel2:#2a2312;--border:#453a1c;--text:#fdf3d8;--muted:#c9b585;--accent:#ffb02e;--accent-soft:rgba(255,176,46,.16);--ok:#8fce6a;--ok-soft:rgba(143,206,106,.14);--warn:#ffcf5c;--err:#ff7a59;--err-soft:rgba(255,122,89,.15)}`,
} as const;

type PresetName = keyof typeof THEME_PRESETS;

export const THEME_PRESET_NAMES: readonly PresetName[] = ["dark", "light", "lobster-red", "carapace-amber"];
/** Every dashboard theme value: the presets plus "custom" (loads ui.themeFile). */
export const ALL_THEME_NAMES: readonly string[] = [...THEME_PRESET_NAMES, "custom"];

const THEME_LABELS: Record<string, string> = {
  dark: "Dark",
  light: "Light",
  "lobster-red": "Lobster Red",
  "carapace-amber": "Carapace Amber",
  custom: "Custom (theme file)",
};

export interface ResolvedTheme {
  name: string;
  css: string;
  /** Surfaced in the UI when a custom theme was replaced by a fallback. */
  note?: string;
}

/** Path of the custom theme stylesheet (ui.themeFile, default ~/.carapace/theme.css). */
export function customThemeFilePath(config: CarapaceConfig): string {
  const configured = config.ui?.themeFile;
  if (typeof configured === "string" && configured.trim() !== "") return expandTilde(configured.trim());
  return join(carapaceHome(), "theme.css");
}

/**
 * Doctor-grade sanity check for a custom theme stylesheet: non-empty, no markup,
 * and at least one rule with balanced braces. A heuristic — CSS lints live in the
 * browser — but it catches the common failure of pasting HTML into the file.
 */
export function validateThemeCss(css: string): { ok: true } | { ok: false; reason: string } {
  const trimmed = css.trim();
  if (trimmed === "") return { ok: false, reason: "file is empty" };
  if (trimmed.includes("<")) return { ok: false, reason: "contains '<' — looks like markup, not CSS" };
  const open = (trimmed.match(/\{/g) ?? []).length;
  const close = (trimmed.match(/\}/g) ?? []).length;
  if (open === 0) return { ok: false, reason: "no CSS rules found (missing '{')" };
  if (open !== close) return { ok: false, reason: `unbalanced braces (${open} '{' vs ${close} '}')` };
  return { ok: true };
}

/**
 * Resolve the effective dashboard theme. `override` (?theme= in the URL) lets the
 * dashboard preview presets without touching config; invalid values fall back to
 * the configured theme. Broken custom files degrade to dark with a visible note —
 * the gateway must never fail to render because of a theme file.
 */
export function resolveThemeCss(config: CarapaceConfig, override?: string | null): ResolvedTheme {
  const requested =
    typeof override === "string" && (ALL_THEME_NAMES as readonly string[]).includes(override) ? override : null;
  const name = requested ?? config.ui?.theme ?? "dark";
  if (name !== "custom") {
    const preset = (THEME_PRESETS as Record<string, string>)[name] ?? THEME_PRESETS.dark;
    return { name, css: preset };
  }
  const themePath = customThemeFilePath(config);
  try {
    if (!existsSync(themePath)) {
      return {
        name: "dark",
        css: THEME_PRESETS.dark,
        note: `custom theme file not found (${themePath}) — using dark; set ui.theme to a preset or create the file`,
      };
    }
    const css = readFileSync(themePath, "utf8");
    const verdict = validateThemeCss(css);
    if (!verdict.ok) {
      return { name: "dark", css: THEME_PRESETS.dark, note: `custom theme invalid (${verdict.reason}) — using dark` };
    }
    // Dark preset first so a custom file can override individual variables.
    return { name: "custom", css: `${THEME_PRESETS.dark}\n${css}` };
  } catch (error) {
    return {
      name: "dark",
      css: THEME_PRESETS.dark,
      note: `custom theme unreadable (${(error as Error).message}) — using dark`,
    };
  }
}

/** Never the value — only where it lives (config view, #28300). */
function redactSecretValue(value: SecretValue | undefined): string {
  if (value === undefined || value === null) return "(unset)";
  if (typeof value === "string") return "(set inline — value hidden)";
  if ("env" in value) return `(from env:${value.env})`;
  return `(from file:${value.file})`;
}

/** The config the dashboard shows: real structure, secrets replaced by their origin. */
export function redactedConfigView(config: CarapaceConfig): Record<string, unknown> {
  return {
    gateway: {
      host: config.gateway.host,
      port: config.gateway.port,
      apiToken: redactSecretValue(config.gateway.apiToken),
      busyQueueLimit: config.gateway.busyQueueLimit,
    },
    llm: {
      baseURL: config.llm.baseURL,
      model: config.llm.model,
      apiKey: redactSecretValue(config.llm.apiKey),
      timeoutMs: config.llm.timeoutMs,
      turnTimeoutMs: config.llm.turnTimeoutMs,
      watchdogTimeoutSec: config.llm.watchdogTimeoutSec,
    },
    channels: {
      telegram: {
        enabled: config.channels.telegram.enabled,
        botToken: redactSecretValue(config.channels.telegram.botToken),
        allowedSenders: config.channels.telegram.allowedSenders,
        mediaDir: config.channels.telegram.mediaDir,
        business: config.channels.telegram.business,
      },
      api: { enabled: config.channels.api.enabled },
    },
    agent: {
      systemPrompt: config.agent.systemPrompt,
      maxToolIterations: config.agent.maxToolIterations,
      announceTarget: config.agent.announceTarget,
    },
    tools: {
      allowedRoots: config.tools.allowedRoots,
      exec: { timeoutMs: config.tools.exec.timeoutMs, denylist: config.tools.exec.denylist },
    },
    senders: config.senders ?? [],
    storage: { path: config.storage.path },
    ui: {
      theme: config.ui?.theme ?? "dark",
      themeFile: config.ui?.themeFile ?? join(carapaceHome(), "theme.css"),
    },
  };
}

export interface DashboardDeps {
  config: CarapaceConfig;
  sessions: SessionDirectory;
  store: Pick<CarapaceStore, "getSession" | "listRecentMessages" | "countSessions" | "countAllMessages">;
  channels: Array<Pick<ChannelAdapter, "name" | "isConfigured" | "describe">>;
}

/** Minimal query-string reader (the ambient URL type carries no searchParams). */
function queryValue(url: string | undefined, key: string): string | null {
  const query = (url ?? "").split("?")[1] ?? "";
  for (const pair of query.split("&")) {
    if (pair === "") continue;
    const separator = pair.indexOf("=");
    const name = separator === -1 ? pair : pair.slice(0, separator);
    if (name !== key) continue;
    const raw = separator === -1 ? "" : pair.slice(separator + 1);
    try {
      return decodeURIComponent(raw.replace(/\+/g, " "));
    } catch {
      return raw;
    }
  }
  return null;
}

/** Seconds since this module loaded ≈ process start (ambient types have no process.uptime). */
const DASHBOARD_STARTED_AT = Date.now();

/** Dashboard + status endpoints. Data endpoints require the API bearer token when
 * gateway.apiToken is configured — exactly like the API channel (#28300). */
export function mountDashboardRoutes(routes: RouteTable, deps: DashboardDeps): void {
  const { config } = deps;

  routes.add("GET", "/ui", (request, response) => {
    const override = queryValue(request.url, "theme");
    const theme = resolveThemeCss(config, override);
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end(renderDashboardPage(theme));
  });

  routes.add("GET", "/api/v1/status", (request, response) => {
    if (!requestAuthorized(config, request)) {
      respondUnauthorized(response);
      return;
    }
    respondJson(response, 200, {
      version: VERSION,
      node: process.version,
      uptimeSec: Math.floor((Date.now() - DASHBOARD_STARTED_AT) / 1000),
      model: config.llm.model,
      llmBaseURL: config.llm.baseURL,
      storage: {
        path: config.storage.path,
        sessions: deps.store.countSessions(),
        messages: deps.store.countAllMessages(),
      },
      channels: deps.channels.map((channel) => ({
        name: channel.name,
        configured: channel.isConfigured(),
        describe: channel.describe(),
      })),
      theme: config.ui?.theme ?? "dark",
    });
  });

  routes.add("GET", "/api/v1/config", (request, response) => {
    if (!requestAuthorized(config, request)) {
      respondUnauthorized(response);
      return;
    }
    respondJson(response, 200, redactedConfigView(config));
  });

  // Recent messages of one session, oldest → newest. GET keeps the route table
  // exact-match; the session id travels in the query string.
  routes.add("GET", "/api/v1/sessions/messages", (request, response) => {
    if (!requestAuthorized(config, request)) {
      respondUnauthorized(response);
      return;
    }
    const sessionId = queryValue(request.url, "sessionId");
    if (sessionId === null || sessionId.trim() === "") {
      respondJson(response, 400, {
        error: "invalid_query",
        expected: { sessionId: "string", limit: "integer 1-500 (optional, default 100)" },
      });
      return;
    }
    const parsed = Number.parseInt(queryValue(request.url, "limit") ?? "100", 10);
    const limit = Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), 500) : 100;
    const session = deps.store.getSession(sessionId);
    if (session === null) {
      respondJson(response, 404, { error: "session_not_found", sessionId });
      return;
    }
    const messages = deps.store.listRecentMessages(sessionId, limit).map((row) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      toolName: row.toolName,
      createdAt: row.createdAt,
    }));
    respondJson(response, 200, {
      session: { id: session.id, channel: session.channel, updatedAt: session.updatedAt },
      messages,
    });
  });

  // Session reset: deletes the session row (messages cascade) — the same primitive
  // the docs call "reset", exposed for the dashboard's per-session buttons.
  routes.add("POST", "/api/v1/sessions/reset", async (request, response) => {
    if (!requestAuthorized(config, request)) {
      respondUnauthorized(response);
      return;
    }
    const body = await readJsonBody(request);
    if (!body.ok) {
      respondJson(response, body.status, { error: body.error });
      return;
    }
    const record = body.value as Record<string, unknown>;
    const sessionId = typeof record.sessionId === "string" ? record.sessionId : null;
    if (sessionId === null || sessionId.trim() === "") {
      respondJson(response, 400, { error: "invalid_body", expected: { sessionId: "string" } });
      return;
    }
    const deleted = deps.sessions.delete(sessionId);
    if (!deleted) {
      respondJson(response, 404, { error: "session_not_found", sessionId });
      return;
    }
    respondJson(response, 200, { ok: true, sessionId });
  });
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? character);
}

const DASHBOARD_CSS = `
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif; background: var(--bg); color: var(--text); font-size: 14px; line-height: 1.5; }
header { display: flex; align-items: center; gap: 12px; padding: 10px 16px; background: var(--panel); border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 5; flex-wrap: wrap; }
.brand { font-weight: 700; font-size: 15px; }
.brand .ver { color: var(--muted); font-weight: 400; font-size: 12px; }
nav { display: flex; gap: 4px; flex-wrap: wrap; }
nav button { background: transparent; border: 1px solid transparent; color: var(--muted); padding: 5px 11px; border-radius: 8px; cursor: pointer; font-size: 13px; font-family: inherit; }
nav button:hover { color: var(--text); background: var(--panel2); }
nav button.active { color: var(--text); background: var(--panel2); border-color: var(--border); }
.spacer { flex: 1; }
.theme-label { color: var(--muted); font-size: 12px; }
select, input, textarea { background: var(--panel2); color: var(--text); border: 1px solid var(--border); border-radius: 8px; padding: 6px 9px; font: inherit; }
textarea { width: 100%; min-height: 74px; resize: vertical; }
main { max-width: 980px; margin: 0 auto; padding: 16px; display: flex; flex-direction: column; gap: 14px; }
.panel { display: none; }
.panel.visible { display: block; }
.card { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; }
.card h2 { margin: 0 0 10px; font-size: 15px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.card h3 { margin: 0 0 6px; font-size: 14px; }
.kv { display: grid; grid-template-columns: 130px 1fr; gap: 4px 12px; align-items: baseline; }
.kvline { display: grid; grid-template-columns: 130px 1fr; gap: 4px 12px; align-items: baseline; }
.k { color: var(--muted); }
.row-actions { display: flex; gap: 8px; align-items: center; margin-top: 10px; flex-wrap: wrap; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border); vertical-align: middle; }
th { color: var(--muted); font-weight: 600; font-size: 12px; }
td code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
button.action { background: var(--accent-soft); border: 1px solid var(--accent); color: var(--accent); border-radius: 8px; padding: 4px 11px; cursor: pointer; font-size: 12px; font-family: inherit; }
button.action.danger { background: var(--err-soft); border-color: var(--err); color: var(--err); }
a.action-link { display: inline-block; margin-top: 8px; background: var(--accent-soft); border: 1px solid var(--accent); color: var(--accent); border-radius: 8px; padding: 4px 11px; font-size: 12px; text-decoration: none; }
.chip { display: inline-block; padding: 1px 9px; border-radius: 999px; font-size: 11px; border: 1px solid var(--border); background: var(--panel2); color: var(--muted); }
.chip.ok { color: var(--ok); border-color: var(--ok); background: var(--ok-soft); }
.chips { display: flex; gap: 6px; flex-wrap: wrap; }
.msg { border: 1px solid var(--border); border-left: 3px solid var(--muted); border-radius: 10px; padding: 8px 12px; margin-bottom: 8px; background: var(--panel2); overflow-wrap: anywhere; }
.msg.user { border-left-color: var(--accent); }
.msg.assistant { border-left-color: var(--ok); }
.msg .meta { font-size: 11px; color: var(--muted); margin-bottom: 4px; display: flex; gap: 8px; align-items: center; }
#chatlog { max-height: 340px; overflow-y: auto; margin-top: 12px; }
.note { color: var(--muted); font-size: 12px; }
.error { color: var(--err); font-size: 13px; }
#tokenbar { display: none; align-items: center; gap: 8px; padding: 8px 16px; background: var(--warn); color: #201a00; flex-wrap: wrap; }
#tokenbar input { flex: 1; min-width: 220px; }
details { border: 1px solid var(--border); border-radius: 8px; padding: 6px 10px; margin: 6px 0; background: var(--panel2); }
summary { cursor: pointer; color: var(--text); font-weight: 600; font-size: 13px; }
.plugin-card { margin-bottom: 10px; }
`;

// Dashboard client. Plain ES2019 — no build step, no dependencies. All user data is
// rendered through textContent (never innerHTML), and the bearer token lives only in
// this browser's localStorage, sent as an Authorization header on /api/v1 calls.
const APP_JS = `
(function () {
  "use strict";
  var TOKEN_KEY = "carapace.dashboard.token";
  var state = { sessionId: null };

  function byId(id) { return document.getElementById(id); }
  function token() { try { return window.localStorage.getItem(TOKEN_KEY) || ""; } catch (err) { return ""; } }
  function saveToken(value) {
    try {
      if (value) { window.localStorage.setItem(TOKEN_KEY, value); } else { window.localStorage.removeItem(TOKEN_KEY); }
    } catch (err) { /* storage unavailable */ }
  }
  function errText(err) { return err && err.message ? err.message : String(err); }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) { node.className = cls; }
    if (text !== undefined && text !== null) { node.textContent = String(text); }
    return node;
  }
  function clear(node) { while (node.firstChild) { node.removeChild(node.firstChild); } }

  function showTokenBar(message) {
    byId("tokenbar").style.display = "flex";
    if (message) { byId("tokenmsg").textContent = message; }
  }

  function request(path, options) {
    options = options || {};
    var headers = options.headers || {};
    var saved = token();
    if (saved) { headers["Authorization"] = "Bearer " + saved; }
    options.headers = headers;
    return window.fetch(path, options).then(function (res) {
      if (res.status === 401) { showTokenBar("This gateway requires the API bearer token (gateway.apiToken)."); }
      return res;
    });
  }

  function getJson(path) {
    return request(path).then(function (res) {
      return res.text().then(function (body) {
        if (!res.ok) { throw new Error(res.status + " " + body); }
        return body ? JSON.parse(body) : {};
      });
    });
  }

  function fmtTime(ms) { if (!ms) { return ""; } return new Date(ms).toLocaleString(); }
  function fmtUptime(sec) {
    var d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
    if (d) { return d + "d " + h + "h"; }
    if (h) { return h + "h " + m + "m"; }
    if (m) { return m + "m " + Math.floor(sec % 60) + "s"; }
    return sec + "s";
  }

  var current = "status";
  function select(name) {
    current = name;
    var tabs = document.querySelectorAll("nav [data-tab]");
    for (var i = 0; i < tabs.length; i++) { tabs[i].classList.toggle("active", tabs[i].getAttribute("data-tab") === name); }
    var panels = document.querySelectorAll(".panel");
    for (var j = 0; j < panels.length; j++) { panels[j].classList.toggle("visible", panels[j].id === "panel-" + name); }
    if (name === "status") { loadStatus(); }
    if (name === "sessions") { loadSessions(); }
    if (name === "messages" && state.sessionId) { loadMessages(); }
    if (name === "config") { loadConfigView(); }
    if (name === "plugins") { loadPlugins(); }
  }

  function kvRow(key, value) {
    var row = el("div", "kvline");
    row.appendChild(el("span", "k", key));
    row.appendChild(el("span", "v", value));
    return row;
  }

  function loadStatus() {
    var box = byId("status-body");
    return getJson("/api/v1/status").then(function (s) {
      clear(box); box.className = "kv";
      box.appendChild(kvRow("version", "v" + s.version));
      box.appendChild(kvRow("uptime", fmtUptime(s.uptimeSec)));
      box.appendChild(kvRow("node", s.node));
      box.appendChild(kvRow("model", s.model + " @ " + s.llmBaseURL));
      box.appendChild(kvRow("storage", s.storage.path + " (" + s.storage.sessions + " sessions, " + s.storage.messages + " messages)"));
      var channelRow = el("div", "kvline");
      channelRow.appendChild(el("span", "k", "channels"));
      var chips = el("span", "chips");
      (s.channels || []).forEach(function (c) {
        chips.appendChild(el("span", "chip" + (c.configured ? " ok" : ""), c.name + (c.configured ? " \\u2713" : " off")));
      });
      channelRow.appendChild(chips);
      box.appendChild(channelRow);
    }).catch(function (err) {
      box.className = "error"; clear(box); box.textContent = "status: " + errText(err);
    });
  }

  function loadSessions() {
    var box = byId("sessions-body");
    return getJson("/api/v1/sessions").then(function (data) {
      clear(box); box.className = "";
      var sessions = data.sessions || [];
      if (sessions.length === 0) { box.className = "note"; box.textContent = "No sessions yet \\u2014 send the agent a message first."; return; }
      var table = document.createElement("table");
      var thead = document.createElement("thead"); var headRow = document.createElement("tr");
      ["session", "channel", "messages", "updated", ""].forEach(function (label) {
        var th = document.createElement("th"); th.textContent = label; headRow.appendChild(th);
      });
      thead.appendChild(headRow); table.appendChild(thead);
      var tbody = document.createElement("tbody");
      sessions.forEach(function (s) {
        var tr = document.createElement("tr");
        var idCell = document.createElement("td"); idCell.appendChild(el("code", null, s.id)); tr.appendChild(idCell);
        tr.appendChild(el("td", null, s.channel));
        tr.appendChild(el("td", null, s.messages));
        tr.appendChild(el("td", null, fmtTime(s.updatedAt)));
        var actions = document.createElement("td");
        var view = el("button", "action", "View");
        view.addEventListener("click", function () {
          state.sessionId = s.id;
          byId("msg-session").textContent = s.id;
          select("messages");
        });
        var reset = el("button", "action danger", "Reset");
        reset.addEventListener("click", function () {
          if (!window.confirm("Reset session " + s.id + "? Its message history will be deleted.")) { return; }
          request("/api/v1/sessions/reset", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId: s.id }),
          }).then(function () { loadSessions(); }).catch(function (err) {
            window.alert("reset failed: " + errText(err));
          });
        });
        actions.appendChild(view); actions.appendChild(reset);
        tr.appendChild(actions);
        tbody.appendChild(tr);
      });
      table.appendChild(tbody); box.appendChild(table);
    }).catch(function (err) {
      box.className = "error"; clear(box); box.textContent = "sessions: " + errText(err);
    });
  }

  function loadMessages() {
    var box = byId("messages-body");
    if (!state.sessionId) {
      box.className = "note"; clear(box);
      box.textContent = "Select a session from the Sessions tab.";
      return;
    }
    var limit = parseInt(byId("msg-limit").value, 10) || 100;
    return getJson("/api/v1/sessions/messages?sessionId=" + encodeURIComponent(state.sessionId) + "&limit=" + limit)
      .then(function (data) {
        clear(box); box.className = "";
        var messages = data.messages || [];
        if (messages.length === 0) { box.className = "note"; box.textContent = "No messages in this session."; return; }
        messages.forEach(function (m) {
          var div = el("div", "msg " + m.role);
          var meta = el("div", "meta");
          meta.appendChild(el("span", "chip", m.role));
          if (m.toolName) { meta.appendChild(el("span", "chip", m.toolName)); }
          meta.appendChild(el("span", null, fmtTime(m.createdAt)));
          div.appendChild(meta);
          div.appendChild(el("div", "content", m.content));
          box.appendChild(div);
        });
      }).catch(function (err) {
        box.className = "error"; clear(box); box.textContent = "messages: " + errText(err);
      });
  }

  function chatNote(kind, text) {
    var box = byId("chatlog");
    var div = el("div", "msg " + kind);
    var meta = el("div", "meta");
    meta.appendChild(el("span", "chip", kind === "user" ? "you" : "carapace"));
    div.appendChild(meta);
    div.appendChild(el("div", "content", text));
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
  }

  function sendChat() {
    var text = byId("chat-input").value.trim();
    var sender = byId("chat-sender").value.trim() || "dashboard";
    var errBox = byId("chat-error");
    errBox.textContent = "";
    if (!text) { return; }
    byId("chat-send").disabled = true;
    request("/api/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ senderId: sender, text: text }),
    }).then(function (res) {
      return res.json().then(function (data) { return { ok: res.ok, data: data }; });
    }).then(function (result) {
      if (result.ok) {
        chatNote("user", text);
        chatNote("assistant", result.data.reply || "(empty reply)");
        byId("chat-input").value = "";
      } else {
        errBox.textContent = result.data.error === "busy"
          ? "agent busy \\u2014 the turn queue is full, try again shortly"
          : "error: " + (result.data.error || "unknown");
      }
    }).catch(function (err) {
      errBox.textContent = "send failed: " + errText(err);
    }).then(function () { byId("chat-send").disabled = false; });
  }

  function renderTree(container, key, value) {
    if (value !== null && typeof value === "object") {
      var details = document.createElement("details");
      details.appendChild(el("summary", null, key + (Array.isArray(value) ? " [" + value.length + "]" : "")));
      if (Array.isArray(value)) {
        for (var i = 0; i < value.length; i++) { renderTree(details, "#" + i, value[i]); }
      } else {
        var keys = Object.keys(value);
        for (var k = 0; k < keys.length; k++) { renderTree(details, keys[k], value[keys[k]]); }
      }
      container.appendChild(details);
      return;
    }
    var row = el("div", "kvline");
    row.appendChild(el("span", "k", key));
    row.appendChild(el("span", "v", value === null ? "null" : String(value)));
    container.appendChild(row);
  }

  function loadConfigView() {
    var box = byId("config-body");
    return getJson("/api/v1/config").then(function (data) {
      clear(box); box.className = "tree";
      var keys = Object.keys(data);
      for (var i = 0; i < keys.length; i++) { renderTree(box, keys[i], data[keys[i]]); }
    }).catch(function (err) {
      box.className = "error"; clear(box); box.textContent = "config: " + errText(err);
    });
  }

  function loadPlugins() {
    var box = byId("plugins-body");
    var emptyMessage = "No plugins loaded. Drop a plugin directory (plugin.json + panel.html) into the plugins folder \\u2014 see the docs.";
    return getJson("/api/v1/plugins").then(function (data) {
      clear(box); box.className = "";
      var plugins = data.plugins || [];
      if (plugins.length === 0) { box.className = "note"; box.textContent = emptyMessage; return; }
      plugins.forEach(function (p) {
        var card = el("div", "card plugin-card");
        card.appendChild(el("h3", null, p.title || p.name));
        var chips = el("div", "chips");
        if (p.version) { chips.appendChild(el("span", "chip", "v" + p.version)); }
        chips.appendChild(el("span", "chip", p.source));
        if (!p.hasPanel) { chips.appendChild(el("span", "chip", "no panel.html")); }
        card.appendChild(chips);
        if (p.description) { card.appendChild(el("p", "note", p.description)); }
        if (p.hasPanel) {
          var link = el("a", "action-link", "Open panel \\u2197");
          link.href = "/ui/plugins/" + p.name + "/";
          link.target = "_blank";
          link.rel = "noopener";
          card.appendChild(link);
        }
        box.appendChild(card);
      });
    }).catch(function () {
      box.className = "note"; clear(box); box.textContent = emptyMessage;
    });
  }

  byId("token-save").addEventListener("click", function () {
    var input = byId("token-input");
    saveToken(input.value.trim());
    input.value = "";
    byId("tokenbar").style.display = "none";
    select(current);
  });
  byId("token-clear").addEventListener("click", function () {
    saveToken("");
    byId("tokenbar").style.display = "none";
    select(current);
  });
  byId("status-refresh").addEventListener("click", function () { loadStatus(); });
  byId("msg-refresh").addEventListener("click", function () { loadMessages(); });
  byId("chat-send").addEventListener("click", sendChat);
  byId("chat-input").addEventListener("keydown", function (event) {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { sendChat(); }
  });

  var themeSelect = byId("theme");
  var initialTheme = document.documentElement.getAttribute("data-theme") || "dark";
  var requestedTheme = new URLSearchParams(window.location.search).get("theme");
  var requestedValid = false;
  if (requestedTheme !== null) {
    for (var i = 0; i < themeSelect.options.length; i++) {
      if (themeSelect.options[i].value === requestedTheme) { requestedValid = true; break; }
    }
  }
  themeSelect.value = requestedValid ? requestedTheme : initialTheme;
  if (requestedValid && requestedTheme !== initialTheme) {
    byId("themenote").textContent = "Previewing theme '" + requestedTheme + "' \\u2014 persist it by setting ui.theme in ~/.carapace/config.json";
  }
  themeSelect.addEventListener("change", function () {
    var value = themeSelect.value;
    window.location.href = value ? "/ui?theme=" + encodeURIComponent(value) : "/ui";
  });

  var tabs = document.querySelectorAll("nav [data-tab]");
  for (var t = 0; t < tabs.length; t++) {
    (function (btn) {
      btn.addEventListener("click", function () { select(btn.getAttribute("data-tab")); });
    })(tabs[t]);
  }

  window.setInterval(function () { if (current === "status") { loadStatus(); } }, 15000);
  select("status");
})();
`;

export function renderDashboardPage(theme: ResolvedTheme): string {
  const options = ALL_THEME_NAMES.map(
    (name) => `    <option value="${name}">${THEME_LABELS[name] ?? name}</option>`,
  ).join("\n");
  return `<!doctype html>
<html lang="en" data-theme="${escapeHtml(theme.name)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>carapace ${VERSION} — dashboard</title>
<style>
${theme.css}
${DASHBOARD_CSS}
</style>
</head>
<body>
<header>
  <div class="brand">\u{1F422} carapace <span class="ver">v${VERSION}</span></div>
  <nav>
    <button data-tab="status" class="active">Status</button>
    <button data-tab="sessions">Sessions</button>
    <button data-tab="messages">Messages</button>
    <button data-tab="chat">Chat</button>
    <button data-tab="config">Config</button>
    <button data-tab="plugins">Plugins</button>
  </nav>
  <div class="spacer"></div>
  <label class="theme-label" for="theme">theme</label>
  <select id="theme">
${options}
  </select>
</header>
<div id="tokenbar">
  <span id="tokenmsg"></span>
  <input id="token-input" type="password" placeholder="bearer token" autocomplete="off">
  <button class="action" id="token-save">Save</button>
  <button class="action" id="token-clear">Clear</button>
</div>
<main>
  <div id="themenote" class="note">${escapeHtml(theme.note ?? "")}</div>
  <section class="panel visible" id="panel-status">
    <div class="card">
      <h2>Status</h2>
      <div id="status-body" class="note">loading\u2026</div>
      <div class="row-actions"><button class="action" id="status-refresh">Refresh</button></div>
    </div>
  </section>
  <section class="panel" id="panel-sessions">
    <div class="card">
      <h2>Sessions</h2>
      <div id="sessions-body" class="note">loading\u2026</div>
    </div>
  </section>
  <section class="panel" id="panel-messages">
    <div class="card">
      <h2>Messages <span id="msg-session" class="chip"></span></h2>
      <div class="row-actions">
        <label for="msg-limit">limit</label>
        <select id="msg-limit"><option>50</option><option selected>100</option><option>200</option></select>
        <button class="action" id="msg-refresh">Refresh</button>
      </div>
      <div id="messages-body" class="note">select a session from the Sessions tab</div>
    </div>
  </section>
  <section class="panel" id="panel-chat">
    <div class="card">
      <h2>Chat console</h2>
      <div class="row-actions"><label for="chat-sender">sender</label><input id="chat-sender" value="dashboard" size="14"></div>
      <textarea id="chat-input" placeholder="message the agent\u2026 (ctrl+enter to send)"></textarea>
      <div class="row-actions"><button class="action" id="chat-send">Send</button><span id="chat-error" class="error"></span></div>
      <div id="chatlog"></div>
    </div>
  </section>
  <section class="panel" id="panel-config">
    <div class="card">
      <h2>Config <span class="chip">secrets redacted</span></h2>
      <div id="config-body" class="note">loading\u2026</div>
    </div>
  </section>
  <section class="panel" id="panel-plugins">
    <div class="card">
      <h2>Plugins</h2>
      <div id="plugins-body" class="note">loading\u2026</div>
    </div>
  </section>
</main>
<script>
${APP_JS}
</script>
</body>
</html>
`;
}
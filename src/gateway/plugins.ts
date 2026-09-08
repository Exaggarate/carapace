// Plugin-UI foundation (#66944): a plugins/ directory convention. Each plugin is a
// directory with a plugin.json manifest that may serve panel.html + panel.js under
// /ui/plugins/<name>/. Scan roots, in order: bundled <packageRoot>/plugins (ships the
// system-info example), user ~/.carapace/plugins, plus one optional ui.pluginsDir.
// First declaration of a name wins; broken manifests are reported and skipped.
// Only the exact allow-listed file names are served — no arbitrary file access.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { carapaceHome, expandTilde, type CarapaceConfig } from "../config.js";
import type { ServerResponse } from "node:http";
import { respondUnauthorized, requestAuthorized } from "./channels/api.js";
import { respondJson, type RouteTable } from "./server.js";

/** URL/path-safe plugin names: lowercase letters, digits, dashes. */
const PLUGIN_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

/** Files a plugin may serve; anything else is ignored (no arbitrary file serving). */
const PLUGIN_FILES: readonly string[] = ["panel.html", "panel.js"];

const PLUGIN_CONTENT_TYPES: Record<string, string> = {
  "panel.html": "text/html; charset=utf-8",
  "panel.js": "text/javascript; charset=utf-8",
};

export interface PluginManifest {
  name: string;
  title: string;
  description: string;
  version: string;
}

export interface LoadedPlugin {
  manifest: PluginManifest;
  /** Absolute directory of the plugin (the one containing plugin.json). */
  dir: string;
  source: "bundled" | "user" | "custom";
}

export interface PluginScan {
  plugins: LoadedPlugin[];
  /** Non-fatal problems (broken manifests, unreadable roots). Affected plugins are skipped. */
  issues: string[];
}

interface PluginRoot {
  dir: string;
  source: "bundled" | "user" | "custom";
}

/** Package root: dist/gateway/plugins.js → <packageRoot>/ (repo or installed package). */
export function pluginPackageRoot(): string {
  return fileURLToPath(new URL("../../", import.meta.url));
}

export function pluginRoots(config: CarapaceConfig): PluginRoot[] {
  const roots: PluginRoot[] = [
    { dir: join(pluginPackageRoot(), "plugins"), source: "bundled" },
    { dir: join(carapaceHome(), "plugins"), source: "user" },
  ];
  const extra = config.ui?.pluginsDir;
  if (typeof extra === "string" && extra.trim() !== "") {
    roots.push({ dir: expandTilde(extra.trim()), source: "custom" });
  }
  return roots;
}

/** Read + validate one plugin.json; returns the manifest or why it is invalid. */
function readManifest(dir: string): { ok: true; manifest: PluginManifest } | { ok: false; reason: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(dir, "plugin.json"), "utf8"));
  } catch (error) {
    return { ok: false, reason: `plugin.json is not valid JSON (${(error as Error).message})` };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: "plugin.json must be a JSON object" };
  }
  const record = raw as Record<string, unknown>;
  if (typeof record.name !== "string" || !PLUGIN_NAME_RE.test(record.name)) {
    return { ok: false, reason: 'plugin.json "name" must match [a-z0-9][a-z0-9-]*' };
  }
  if (typeof record.title !== "string" || record.title.trim() === "") {
    return { ok: false, reason: 'plugin.json "title" must be a non-empty string' };
  }
  return {
    ok: true,
    manifest: {
      name: record.name,
      title: record.title.trim(),
      description: typeof record.description === "string" ? record.description.trim() : "",
      version: typeof record.version === "string" ? record.version.trim() : "",
    },
  };
}

/** Scan every plugin root and aggregate the boot manifest. Never throws. */
export function scanPlugins(config: CarapaceConfig): PluginScan {
  const plugins = new Map<string, LoadedPlugin>();
  const issues: string[] = [];
  for (const root of pluginRoots(config)) {
    let entries: string[];
    try {
      if (!existsSync(root.dir) || !statSync(root.dir).isDirectory()) continue;
      entries = readdirSync(root.dir);
    } catch (error) {
      issues.push(`${root.source} plugin root ${root.dir}: unreadable (${(error as Error).message})`);
      continue;
    }
    for (const entry of entries.sort()) {
      const dir = join(root.dir, entry);
      try {
        if (!statSync(dir).isDirectory()) continue;
      } catch {
        continue; // vanished mid-scan
      }
      if (!existsSync(join(dir, "plugin.json"))) continue; // not a plugin directory
      const verdict = readManifest(dir);
      if (!verdict.ok) {
        issues.push(`plugin ${entry}: ${verdict.reason}`);
        continue;
      }
      if (plugins.has(verdict.manifest.name)) {
        issues.push(`plugin ${entry}: duplicate name "${verdict.manifest.name}" ignored (${root.source})`);
        continue;
      }
      plugins.set(verdict.manifest.name, { manifest: verdict.manifest, dir, source: root.source });
    }
  }
  return {
    plugins: [...plugins.values()].sort((a, b) => a.manifest.name.localeCompare(b.manifest.name)),
    issues,
  };
}

/** The manifest the dashboard sees: no filesystem paths, just declared metadata. */
export function pluginPublicView(scan: PluginScan): Array<Record<string, unknown>> {
  return scan.plugins.map((plugin) => ({
    name: plugin.manifest.name,
    title: plugin.manifest.title,
    description: plugin.manifest.description,
    version: plugin.manifest.version,
    source: plugin.source,
    hasPanel: existsSync(join(plugin.dir, "panel.html")),
  }));
}

function servePluginFile(response: ServerResponse, plugin: LoadedPlugin, file: string): void {
  if (!(PLUGIN_FILES as readonly string[]).includes(file)) {
    respondJson(response, 404, { error: "not_found" });
    return;
  }
  try {
    const body = readFileSync(join(plugin.dir, file), "utf8");
    response.writeHead(200, {
      "content-type": PLUGIN_CONTENT_TYPES[file] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(body);
  } catch (error) {
    respondJson(response, 500, { error: "plugin_file_unavailable", detail: (error as Error).message });
  }
}

/** Plugin-UI routes: the manifest endpoint plus one exact-match route set per
 * plugin. Paths are fixed at boot from validated names, so panel serving cannot
 * escape the plugin directory by construction (#66944). */
export function mountPluginRoutes(routes: RouteTable, config: CarapaceConfig, scan: PluginScan): void {
  routes.add("GET", "/api/v1/plugins", (request, response) => {
    if (!requestAuthorized(config, request)) {
      respondUnauthorized(response);
      return;
    }
    respondJson(response, 200, { plugins: pluginPublicView(scan) });
  });

  for (const plugin of scan.plugins) {
    const base = `/ui/plugins/${plugin.manifest.name}`;
    routes.add("GET", base, (_request, response) => {
      // Redirect to the trailing-slash URL so relative panel assets resolve.
      response.writeHead(302, { location: `${base}/` });
      response.end();
    });
    routes.add("GET", `${base}/`, (_request, response) => {
      servePluginFile(response, plugin, "panel.html");
    });
    routes.add("GET", `${base}/panel.js`, (_request, response) => {
      servePluginFile(response, plugin, "panel.js");
    });
  }
}
// Provides schema hint metadata for config docs and UI labels.
import {
  isSensitiveUrlConfigPath,
  SENSITIVE_URL_HINT_TAG,
} from "@carapace/net-policy/redact-sensitive-url";
import type { z } from "zod";
import type { ConfigUiHints } from "../shared/config-ui-hints-types.js";
import { isKernelOwnedChannelConfigKey } from "./channel-config-keys.js";
import { FIELD_HELP } from "./schema.help.js";
import { FIELD_LABELS } from "./schema.labels.js";
import { applyDerivedTags } from "./schema.tags.js";
import { applyConfigTierHints } from "./schema.tiers.js";
import { walkConfigSchema } from "./schema.walk.js";
import { isSensitiveConfigPath } from "./sensitive-paths.js";
import { sensitive } from "./zod-schema.sensitive.js";

export type { ConfigUiHint, ConfigUiHints } from "../shared/config-ui-hints-types.js";

const GROUP_HINTS = [
  ["wizard", "Wizard", 20],
  ["update", "Update", 25],
  ["cli", "CLI", 26],
  ["diagnostics", "Diagnostics", 27],
  ["telemetry", "Telemetry", 28],
  ["logging", "Logging", 900],
  ["gateway", "Gateway", 30],
  ["nodeHost", "Node Host", 35],
  ["cloudWorkers", "Cloud Workers", 37],
  ["desktop", "Desktop", 38],
  ["agents", "Agents", 40],
  ["tools", "Tools", 50],
  ["bindings", "Bindings", 55],
  ["audio", "Audio", 60],
  ["models", "Models", 70],
  ["messages", "Messages", 80],
  ["commands", "Commands", 85],
  ["session", "Session", 90],
  ["cron", "Automations", 100],
  ["worktreeRoot", "Worktree Root", 105],
  ["hooks", "Hooks", 110],
  ["ui", "UI", 120],
  ["browser", "Browser", 130],
  ["talk", "Talk", 140],
  ["channels", "Messaging Channels", 150],
  ["skills", "Skills", 200],
  ["plugins", "Plugins", 205],
  ["discovery", "Discovery", 210],
  ["presence", "Presence", 220],
  ["voicewake", "Voice Wake", 230],
] as const;

// docsUrl targets task-oriented or beginner pages; configuration-reference anchors are banned.
const SECTION_DOCS_URLS = {
  accessGroups: "https://github.com/Exaggarate/carapace",
  messages: "https://github.com/Exaggarate/carapace",
  tts: "https://github.com/Exaggarate/carapace",
  commands: "https://github.com/Exaggarate/carapace",
  hooks: "https://github.com/Exaggarate/carapace",
  cron: "https://github.com/Exaggarate/carapace",
  bindings: "https://github.com/Exaggarate/carapace",
  plugins: "https://github.com/Exaggarate/carapace",
  mcp: "https://github.com/Exaggarate/carapace",
  memory: "https://github.com/Exaggarate/carapace",
  talk: "https://github.com/Exaggarate/carapace",
  gateway: "https://github.com/Exaggarate/carapace",
  browser: "https://github.com/Exaggarate/carapace",
  nodeHost: "https://github.com/Exaggarate/carapace",
  discovery: "https://github.com/Exaggarate/carapace",
  acp: "https://github.com/Exaggarate/carapace",
  agents: "https://github.com/Exaggarate/carapace",
  models: "https://github.com/Exaggarate/carapace",
  skills: "https://github.com/Exaggarate/carapace",
  tools: "https://github.com/Exaggarate/carapace",
  session: "https://github.com/Exaggarate/carapace",
  security: "https://github.com/Exaggarate/carapace",
  approvals: "https://github.com/Exaggarate/carapace",
  env: "https://github.com/Exaggarate/carapace",
  auth: "https://github.com/Exaggarate/carapace",
  update: "https://github.com/Exaggarate/carapace",
  telemetry: "https://github.com/Exaggarate/carapace",
  logging: "https://github.com/Exaggarate/carapace",
  diagnostics: "https://github.com/Exaggarate/carapace",
  cli: "https://github.com/Exaggarate/carapace",
  secrets: "https://github.com/Exaggarate/carapace",
  ui: "https://github.com/Exaggarate/carapace",
  wizard: "https://github.com/Exaggarate/carapace",
  channels: "https://github.com/Exaggarate/carapace",
  broadcast: "https://github.com/Exaggarate/carapace",
  audio: "https://github.com/Exaggarate/carapace",
  voicewake: "https://github.com/Exaggarate/carapace",
  presence: "https://github.com/Exaggarate/carapace",
  cloudWorkers: "https://github.com/Exaggarate/carapace",
  desktop: "https://github.com/Exaggarate/carapace",
  worktreeRoot: "https://github.com/Exaggarate/carapace",
  proxy: "https://github.com/Exaggarate/carapace",
  transcripts: "https://github.com/Exaggarate/carapace",
  surfaces: "https://github.com/Exaggarate/carapace",
} as const satisfies Record<string, string>;

const FIELD_PLACEHOLDERS: Record<string, string> = {
  "gateway.publicOrigin": "https://gateway.example.com",
  "gateway.remote.url": "ws://host:18789",
  "gateway.remote.tlsFingerprint": "sha256:ab12cd34…",
  "gateway.remote.sshTarget": "user@host",
  "gateway.remote.sshHostKeyPolicy": "strict",
  "gateway.controlUi.basePath": "/carapace",
  "gateway.controlUi.environment.label": "edge",
  "gateway.controlUi.root": "dist/control-ui",
  "gateway.controlUi.allowedOrigins": "https://control.example.com",
  "gateway.push.apns.relay.baseUrl": "https://github.com/Exaggarate/carapace",
  "channels.mattermost.baseUrl": "https://chat.example.com",
  "agents.entries.*.identity.avatar": "avatars/carapace.png",
};

const CHANNEL_NAMESPACE_PREFIX = "channels.";

function isKernelOwnedChannelHintPath(path: string): boolean {
  if (path === "channels") {
    return true;
  }
  const channelKey = path.startsWith(CHANNEL_NAMESPACE_PREFIX)
    ? path.slice(CHANNEL_NAMESPACE_PREFIX.length).split(".", 1)[0]
    : undefined;
  return channelKey !== undefined && isKernelOwnedChannelConfigKey(channelKey);
}

/** Return whether a channel hint path belongs to a plugin-owned channel namespace. */
function isPluginOwnedChannelHintPath(path: string): boolean {
  if (!path.startsWith(CHANNEL_NAMESPACE_PREFIX)) {
    return false;
  }
  return !isKernelOwnedChannelHintPath(path);
}

/** Build core config UI hints while leaving plugin-owned channel hints to plugin schemas. */
export function buildBaseHints(): ConfigUiHints {
  const hints: ConfigUiHints = {};
  for (const [group, label, order] of GROUP_HINTS) {
    hints[group] = {
      label,
      group: label,
      order,
    };
  }
  for (const [path, docsUrl] of Object.entries(SECTION_DOCS_URLS)) {
    hints[path] = { ...hints[path], docsUrl };
  }
  for (const [metadata, field] of [
    [FIELD_LABELS, "label"],
    [FIELD_HELP, "help"],
    [FIELD_PLACEHOLDERS, "placeholder"],
  ] as const) {
    for (const [path, value] of Object.entries(metadata)) {
      if (!isPluginOwnedChannelHintPath(path)) {
        hints[path] = { ...hints[path], [field]: value };
      }
    }
  }
  for (const path of ["agents.defaults.models.*", "agents.entries.*.models.*"]) {
    const runtimePath = `${path}.agentRuntime`;
    const codeModePath = `${path}.codeMode`;
    hints[runtimePath] = { ...hints[runtimePath], order: -2 };
    hints[codeModePath] = { ...hints[codeModePath], order: -1, placeholder: "Default" };
  }
  return applyDerivedTags(applyConfigTierHints(hints));
}

/** Mark sensitive config paths in a hint map without overwriting explicit sensitivity metadata. */
export function applySensitiveHints(
  hints: ConfigUiHints,
  allowedKeys?: ReadonlySet<string>,
): ConfigUiHints {
  const next = { ...hints };
  const keys = allowedKeys ? [...allowedKeys] : Object.keys(next);
  for (const key of keys) {
    const current = next[key];
    if (current?.sensitive !== undefined) {
      continue;
    }
    if (isSensitiveConfigPath(key)) {
      next[key] = { ...current, sensitive: true };
    }
  }
  return next;
}

/** Add the sensitive-url tag to hint paths that carry URLs with credential risk. */
export function applySensitiveUrlHints(
  hints: ConfigUiHints,
  allowedKeys?: ReadonlySet<string>,
): ConfigUiHints {
  const next = { ...hints };
  const keys = allowedKeys ? [...allowedKeys] : Object.keys(next);
  for (const key of keys) {
    if (!isSensitiveUrlConfigPath(key)) {
      continue;
    }
    const current = next[key];
    const tags = new Set(current?.tags ?? []);
    tags.add(SENSITIVE_URL_HINT_TAG);
    next[key] = {
      ...current,
      tags: [...tags],
    };
  }
  return next;
}

/**
 * Traverses the Zod schema tree and returns a copy of `hints` with every
 * sensitive path marked and credential-bearing URL paths tagged.
 */
export function mapSensitivePaths(
  schema: z.ZodType,
  path: string,
  hints: ConfigUiHints,
): ConfigUiHints {
  const next = { ...hints };
  const urlPaths = new Set<string>();
  walkConfigSchema(schema, path, (fieldSchema, fieldPath) => {
    if (sensitive.has(fieldSchema)) {
      next[fieldPath] = { ...next[fieldPath], sensitive: true };
    }
    if (fieldPath && isSensitiveUrlConfigPath(fieldPath)) {
      urlPaths.add(fieldPath);
    }
  });
  return applySensitiveUrlHints(next, urlPaths);
}

/** @internal */
export const testApi = {
  SECTION_DOCS_URLS,
};

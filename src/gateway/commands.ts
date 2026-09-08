// M11 conversational UX — shared slash-command layer.
// One implementation of the bot commands (/start /help /status /sessions /reset
// /id /skills /automations) for every chat channel, so Telegram and Discord stay
// in sync and new commands land once. Channels call handleSlashCommand() for
// text that starts with "/" and send the returned text; non-command text returns
// null and flows to the agent as usual. Unknown commands get a friendly notice
// instead of being fed to the model as a bare "/…" token.

import type { CarapaceConfig } from "../config.js";
import type { SkillRegistry } from "../core/skills.js";
import type { AutomationRow } from "../storage/sqlite.js";
import type { SessionDirectory } from "./channels/types.js";

/** Read-only access to the scheduled-job store for /automations. */
export interface AutomationLister {
  list(): AutomationRow[];
}

/** Runtime services the command layer needs beyond config (wired by buildRuntime). */
export interface ChannelCommandServices {
  /** Process start time for /status uptime. */
  startedAtMs: number;
  /** Skill registry for /skills (null in doctor/bare-adapter mode). */
  skills?: SkillRegistry | null;
  /** Automation job lister for /automations (null when the scheduler is off). */
  automations?: AutomationLister | null;
}

export interface CommandContext {
  channel: string;
  chatId: string;
  senderId?: string;
  username?: string;
  version: string;
  startedAtMs: number;
  config: CarapaceConfig;
  sessions: SessionDirectory | null;
  skills?: SkillRegistry | null;
  automations?: AutomationLister | null;
  /** Config-driven welcome override (channels.telegram.startMessage). */
  startMessage?: string;
  /** Channel-specific /id rendering (Telegram keeps its raw chat-id format). */
  idText?: string;
  /** Channel-specific /reset (Telegram is business-aware with a memory flush). */
  reset?: () => Promise<string>;
}

/** A handled command reply. null = not a slash command, fall through to the agent. */
export type SlashOutcome = { text: string } | null;

export const DEFAULT_START_MESSAGE =
  "🦞 **Carapace** is awake — your assistant, on your hardware, in your chats.\n" +
  "\n" +
  "**What I can do**\n" +
  "• **Agent work** — ask anything; I plan, run tools, and answer.\n" +
  "• **Exec & files** — commands and file edits inside the configured workspace.\n" +
  "• **Web** — fetch pages, pull live search results.\n" +
  '• **Memory** — say "remember this"; facts survive across sessions.\n' +
  "• **Skills** — reusable playbooks for bigger jobs (/skills).\n" +
  "• **Automations** — scheduled jobs that fire on time (/automations).\n" +
  "• **Media** — send photos, documents or voice; I read them.\n" +
  "\n" +
  "**Commands**\n" +
  "/help — full reference · /status — engine room · /sessions — history\n" +
  "/reset — fresh start · /skills · /automations · /id\n" +
  "\n" +
  "Sharp, concise, no fluff — tell me what you need. 🦞";

export const DEFAULT_HELP_TEXT =
  "🦞 **Carapace** — command reference\n" +
  "\n" +
  "**Chat & sessions**\n" +
  "/help — this reference\n" +
  "/start — the welcome message\n" +
  "/status — version, uptime, provider & model\n" +
  "/sessions — the 10 most recent sessions\n" +
  "/reset — wipe this chat's session history\n" +
  "/id — chat & sender ids (Telegram)\n" +
  "\n" +
  "**Capabilities**\n" +
  "/skills — installed skill playbooks\n" +
  "/automations — scheduled jobs (manage with `carapace automations` on the host)\n" +
  "\n" +
  "**Working with me**\n" +
  "• Just talk — questions, tasks, photos, documents, voice. No command needed.\n" +
  '• "remember this" — pin a fact into long-term memory.\n' +
  "• Long answers arrive in clean chunks; code keeps its fences, links stay clickable.";

/**
 * Route one inbound text through the command layer. Returns null for anything
 * that is not a slash command; unknown commands return the unknown-command
 * notice instead of reaching the agent.
 */
export async function handleSlashCommand(rawText: string, ctx: CommandContext): Promise<SlashOutcome> {
  const text = rawText.trim();
  if (!text.startsWith("/")) return null;
  const command = (text.split(/[\s@]/)[0] ?? text).toLowerCase();
  switch (command) {
    case "/start":
      return { text: ctx.startMessage ?? DEFAULT_START_MESSAGE };
    case "/help":
      return { text: DEFAULT_HELP_TEXT };
    case "/status":
      return { text: statusText(ctx) };
    case "/sessions":
      return { text: sessionsText(ctx.sessions) };
    case "/id":
      return { text: ctx.idText ?? defaultIdText(ctx) };
    case "/reset":
      return { text: ctx.reset !== undefined ? await ctx.reset() : await defaultReset(ctx) };
    case "/skills":
      return { text: skillsText(ctx.skills ?? null) };
    case "/automations":
      return { text: automationsText(ctx.automations ?? null) };
    default:
      return { text: `🦞 Unknown command "${command}" — /help lists everything I answer to.` };
  }
}

/** /status — the engine-room readout: version, uptime, provider & model. */
function statusText(ctx: CommandContext): string {
  const uptimeMs = Math.max(0, Date.now() - ctx.startedAtMs);
  const fallbacks = ctx.config.llm?.fallbacks?.length ?? 0;
  const steer = ctx.config.channels.telegram?.steerMode === "queue" ? "queue" : "inject";
  const sessionCount = ctx.sessions?.list(100).length ?? 0;
  const lines = [
    `🦞 **Carapace** v${ctx.version}`,
    `uptime: ${formatDuration(uptimeMs)}`,
    `model: ${activeModelLabel(ctx.config)}${fallbacks > 0 ? ` (+${fallbacks} fallback${fallbacks === 1 ? "" : "s"})` : ""}`,
    `channel: ${ctx.channel} · chat ${ctx.chatId}`,
    `sessions: ${sessionCount} active`,
    `steer: ${steer} · business: ${ctx.config.channels.telegram?.business === false ? "off" : "on"}`,
  ];
  return lines.join("\n");
}

/** The provider/model pair currently serving turns, from config (no probing). */
function activeModelLabel(config: CarapaceConfig): string {
  const llm = config.llm;
  const provider = llm?.provider ?? "openai";
  if (provider === "anthropic") return `anthropic/${llm?.anthropic?.model ?? llm?.model ?? "?"}`;
  if (provider === "ollama") return `ollama/${llm?.ollama?.model ?? llm?.model ?? "?"}`;
  return `openai/${llm?.model ?? "?"}`;
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return seconds % 60 === 0 ? `${minutes}m` : `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return minutes % 60 === 0 ? `${hours}h` : `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** /sessions — the ten most recently active sessions with message counts. */
export function sessionsText(directory: SessionDirectory | null): string {
  if (directory === null) {
    return "Session store unavailable — /sessions needs the full gateway runtime.";
  }
  const sessions = directory.list(10);
  if (sessions.length === 0) return "No sessions yet — send me a message to start one.";
  const lines = sessions.map(
    (session) =>
      `${session.id} · ${directory.countMessages(session.id)} msg · updated ${formatAge(Date.now() - session.updatedAt)}`,
  );
  return ["📚 Sessions (10 most recent):", ...lines].join("\n");
}

/** /skills — installed playbooks. */
export function skillsText(registry: SkillRegistry | null): string {
  if (registry === null) return "🧩 Skills need the full gateway runtime — /skills is unavailable here.";
  const skills = registry.list();
  if (skills.length === 0) {
    return "🧩 No skills installed — drop <name>/SKILL.md into ~/.carapace/skills/ to add one.";
  }
  const lines = skills.map((skill) => `• **${skill.name}** — ${skill.description}`);
  return [`🧩 Installed skills (${skills.length}):`, ...lines].join("\n");
}

/** /automations — scheduled jobs. */
export function automationsText(lister: AutomationLister | null): string {
  if (lister === null) return "⏰ Automations need the full gateway runtime — /automations is unavailable here.";
  const jobs = lister.list();
  if (jobs.length === 0) {
    return '⏰ No automations scheduled — add one on the host: `carapace automations add --every 10m --prompt "..." --chat telegram:<id>`.';
  }
  const lines = jobs.map((job) => {
    const next = job.enabled ? nextRunText(job.nextRun) : "paused";
    return `• **${job.name}** — ${job.kind} ${job.spec} → ${job.channel}:${job.chatId}, ${next}${job.enabled ? "" : " (disabled)"}`;
  });
  return [`⏰ Scheduled automations (${jobs.length}):`, ...lines].join("\n");
}

function nextRunText(nextRun: number | null): string {
  if (nextRun === null) return "done";
  const deltaMs = nextRun - Date.now();
  if (deltaMs <= 0) return "due now";
  const seconds = Math.floor(deltaMs / 1000);
  if (seconds < 90) return `in ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 90) return `in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `in ${hours}h`;
  return `in ${Math.floor(hours / 24)}d`;
}

/** Channel-neutral /id — channels with their own id format supply idText. */
function defaultIdText(ctx: CommandContext): string {
  const bits = [`chat id: ${ctx.channel}:${ctx.chatId}`, `sender id: ${ctx.senderId ?? "unknown"}`];
  if (ctx.username !== undefined) bits.push(`username: @${ctx.username}`);
  return bits.join("\n");
}

/** Channel-neutral /reset — delete this chat's session (no memory flush). */
export async function defaultReset(ctx: CommandContext): Promise<string> {
  if (ctx.sessions === null) return "Session store unavailable — /reset needs the full gateway runtime.";
  const existed = ctx.sessions.delete(`${ctx.channel}:${ctx.chatId}`);
  return existed
    ? "🧹 Session reset — this chat's history is cleared; your next message starts a fresh conversation."
    : "🧹 Session reset — nothing to clear; your next message starts a fresh conversation.";
}

function formatAge(ms: number): string {
  const seconds = Math.max(1, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
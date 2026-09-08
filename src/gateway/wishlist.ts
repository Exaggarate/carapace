// Community wishlist panel: the top-liked upstream OpenClaw issues, served as a
// dashboard panel under /ui. Issues come from the GitHub REST API (reactions-sorted)
// and are cached in memory for one hour; per-issue Carapace status comes from the
// in-repo tracker docs/wishlist-status.json, so the panel always reflects what the
// project actually shipped vs. what is still building or deliberately deferred.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const GITHUB_API_BASE = "https://api.github.com";
const ISSUES_PATH = "/repos/openclaw/openclaw/issues";
/** Cache window: one hour of fresh-enough data, then the next /ui visit refetches. */
const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_ISSUES = 30;

export type WishlistStatusState = "shipped" | "building" | "deferred";

export interface WishlistStatusEntry {
  state: WishlistStatusState;
  version?: string;
  feature?: string;
  note?: string;
}

export interface WishlistIssue {
  number: number;
  title: string;
  /** reactions["+1"] — the 👍 count the wishlist is sorted by. */
  likes: number;
  url: string;
  status: WishlistStatusEntry | null;
}

export interface WishlistSnapshot {
  /** github = fresh fetch, cache = served from the 1h cache (or stale fallback). */
  source: "github" | "cache" | "unavailable";
  /** Epoch ms of the last successful GitHub fetch; null when never fetched. */
  fetchedAt: number | null;
  issues: WishlistIssue[];
  note?: string;
}

export interface WishlistOptions {
  /** Test seam: replaces global fetch for the GitHub call. */
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  /** Test seam: clock for cache TTL decisions. */
  now?: () => number;
}

/** The tracker file bundled with the package (docs/wishlist-status.json). */
export function defaultWishlistStatusPath(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  return join(moduleDir, "..", "..", "docs", "wishlist-status.json");
}

/** Defensive parse of one GitHub issue payload; null when the shape is unusable. */
function issueFromGitHub(raw: unknown): WishlistIssue | null {
  if (raw === null || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  // Pull requests ride the /issues endpoint with a pull_request key — skip them.
  if (record.pull_request !== undefined) return null;
  const number = typeof record.number === "number" ? record.number : NaN;
  const title = typeof record.title === "string" ? record.title : "";
  const url = typeof record.html_url === "string" ? record.html_url : "";
  if (!Number.isInteger(number) || title === "" || url === "") return null;
  const reactions = (record.reactions ?? {}) as Record<string, unknown>;
  const likes =
    typeof reactions["+1"] === "number" && Number.isFinite(reactions["+1"]) && reactions["+1"] >= 0
      ? reactions["+1"]
      : 0;
  return { number, title, likes, url, status: null };
}

/** Parse a GitHub /issues response; broken entries are skipped, never fatal. */
export function parseGitHubIssues(payload: unknown): WishlistIssue[] {
  if (!Array.isArray(payload)) return [];
  const issues: WishlistIssue[] = [];
  for (const raw of payload) {
    const issue = issueFromGitHub(raw);
    if (issue !== null) issues.push(issue);
  }
  return issues;
}

/**
 * Read + validate docs/wishlist-status.json. A missing, unreadable, or malformed
 * tracker degrades to an empty map — the panel still renders upstream issues.
 */
export function readWishlistStatusFile(path: string): Record<string, WishlistStatusEntry> {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return {};
  }
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const issues = parsed.issues;
    const entries: Record<string, WishlistStatusEntry> = {};
    if (issues === null || typeof issues !== "object") return entries;
    for (const [key, raw] of Object.entries(issues as Record<string, unknown>)) {
      if (raw === null || typeof raw !== "object") continue;
      const record = raw as Record<string, unknown>;
      const state = record.state;
      if (state !== "shipped" && state !== "building" && state !== "deferred") continue;
      entries[key] = {
        state,
        ...(typeof record.version === "string" && record.version !== "" ? { version: record.version } : {}),
        ...(typeof record.feature === "string" && record.feature !== "" ? { feature: record.feature } : {}),
        ...(typeof record.note === "string" && record.note !== "" ? { note: record.note } : {}),
      };
    }
    return entries;
  } catch {
    return {};
  }
}

/** Reactions-sorted upstream issues, cached for 1h, merged with the status tracker. */
export class WishlistService {
  private readonly fetchImpl: (input: string, init?: RequestInit) => Promise<Response>;
  private readonly now: () => number;
  private cache: { fetchedAt: number; issues: WishlistIssue[] } | null = null;

  constructor(private readonly statusFilePath: string = defaultWishlistStatusPath(), options: WishlistOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Top-liked issues merged with tracker status. Within the 1h TTL the cache is
   * served without a network call; past it (or with force) GitHub is fetched, and
   * a failed fetch degrades to the last good list (or tracker-only when never
   * fetched) so the panel survives GitHub outages.
   */
  async list(force = false): Promise<WishlistSnapshot> {
    const at = this.now();
    const cached = this.cache;
    if (!force && cached !== null && at - cached.fetchedAt < CACHE_TTL_MS) {
      return { source: "cache", fetchedAt: cached.fetchedAt, issues: this.withStatus(cached.issues) };
    }
    try {
      const issues = await this.fetchFromGitHub();
      this.cache = { fetchedAt: at, issues };
      return { source: "github", fetchedAt: at, issues: this.withStatus(issues) };
    } catch (error) {
      if (cached !== null) {
        return {
          source: "cache",
          fetchedAt: cached.fetchedAt,
          issues: this.withStatus(cached.issues),
          note: `GitHub fetch failed (${(error as Error).message}) — showing the cached list`,
        };
      }
      return {
        source: "unavailable",
        fetchedAt: null,
        issues: this.withStatus([]),
        note: `GitHub unavailable (${(error as Error).message}) — tracker entries are still listed`,
      };
    }
  }

  private async fetchFromGitHub(): Promise<WishlistIssue[]> {
    const response = await this.fetchImpl(
      `${GITHUB_API_BASE}${ISSUES_PATH}?sort=reactions&direction=desc&state=all&per_page=50`,
      {
        headers: {
          accept: "application/vnd.github+json",
          "user-agent": "carapace-gateway",
          "x-github-api-version": "2022-11-28",
        },
      },
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = JSON.parse(await response.text()) as unknown;
    const issues = parseGitHubIssues(body);
    issues.sort((a, b) => b.likes - a.likes || a.number - b.number);
    return issues.slice(0, MAX_ISSUES);
  }

  /** Attach tracker status; tracker-only entries (deferred work, off-list items) append. */
  private withStatus(issues: WishlistIssue[]): WishlistIssue[] {
    const statuses = readWishlistStatusFile(this.statusFilePath);
    const seen = new Set<number>();
    const merged = issues.map((issue) => {
      seen.add(issue.number);
      return { ...issue, status: statuses[String(issue.number)] ?? null };
    });
    for (const [key, status] of Object.entries(statuses)) {
      const number = Number.parseInt(key, 10);
      if (!Number.isInteger(number) || seen.has(number)) continue;
      seen.add(number);
      merged.push({
        number,
        title: status.feature ?? `issue #${number} (tracked)`,
        likes: 0,
        url: `https://github.com/openclaw/openclaw/issues/${key}`,
        status,
      });
    }
    return merged;
  }
}
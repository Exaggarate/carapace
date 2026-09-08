// Schedule math for automations (M8). Pure module — no I/O, no clocks — so the
// gateway scheduler, the CLI, and tests all share one implementation.
// Three kinds:
//   at    — one-shot, ISO-8601 timestamp (or "YYYY-MM-DD HH:MM" local)
//   every — fixed interval (ms, s, m, h, d); missed intervals are skipped, never backfilled
//   cron  — 5-field crontab (minute hour dom month dow), minute granularity,
//           evaluated in the SERVER's local timezone
// Day-of-week follows vixie-cron semantics: 0 and 7 both mean Sunday, and when
// both day-of-month and day-of-week are restricted (non-*), the job fires when
// EITHER matches.

export type ScheduleKind = "at" | "every" | "cron";

export class ScheduleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScheduleError";
  }
}

interface CronField {
  values: Set<number>;
  /** False only when the whole field is a bare "*" (wildcard). */
  restricted: boolean;
}

export interface CronFields {
  minute: CronField;
  hour: CronField;
  dom: CronField;
  month: CronField;
  dow: CronField;
}

export interface ParsedSchedule {
  kind: ScheduleKind;
  /** Spec string as persisted in the automations table. */
  spec: string;
  /** kind="at": epoch ms of the one-shot. */
  atMs?: number;
  /** kind="every": interval length in ms (>= 1000). */
  intervalMs?: number;
  /** kind="cron": the five parsed fields. */
  cronFields?: CronFields;
}

const DURATION_UNITS: Record<string, number> = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/** Parse "90s" / "5m" / "2h" / "1d" / "1500ms" / bare "2000" (ms). Minimum 1s. */
export function parseDurationMs(raw: string): number {
  const match = /^(\d+)\s*(ms|s|m|h|d)?$/i.exec(raw.trim());
  if (match === null) {
    throw new ScheduleError(`unrecognized duration "${raw}" (use e.g. 30s, 5m, 2h, 1d, or bare milliseconds)`);
  }
  const amount = Number(match[1]);
  const unit = (match[2] ?? "ms").toLowerCase();
  const ms = amount * (DURATION_UNITS[unit] ?? 1);
  if (ms < 1_000) throw new ScheduleError(`interval must be at least 1000ms (got ${ms}ms)`);
  return ms;
}

/** Human-friendly duration ("90s", "5m", "2h"); falls back to raw ms. */
export function describeDurationMs(ms: number): string {
  if (ms % 86_400_000 === 0) return `${ms / 86_400_000}d`;
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
  if (ms % 60_000 === 0) return `${ms / 60_000}m`;
  if (ms % 1_000 === 0) return `${ms / 1_000}s`;
  return `${ms}ms`;
}

function parseAtSpec(raw: string): number {
  // Accept "YYYY-MM-DD HH:MM[:SS]" with a space by normalizing to ISO "T".
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(raw) ? raw.replace(" ", "T") : raw;
  const ms = Date.parse(normalized);
  if (!Number.isFinite(ms)) {
    throw new ScheduleError(`unrecognized --at timestamp "${raw}" (use ISO 8601, e.g. 2026-09-08T21:30:00)`);
  }
  return ms;
}

/** Parse one cron field: "*" | "a" | "a-b" | ["a"|"*"|"a-b"]+"/step", comma lists. */
function parseCronField(raw: string, label: string, min: number, max: number): CronField {
  const values = new Set<number>();
  for (const term of raw.split(",")) {
    const slash = term.indexOf("/");
    const range = slash >= 0 ? term.slice(0, slash) : term;
    let step = 1;
    if (slash >= 0) {
      const stepRaw = term.slice(slash + 1);
      if (!/^\d+$/.test(stepRaw) || Number(stepRaw) < 1) {
        throw new ScheduleError(`cron ${label} field: invalid step in "${term}"`);
      }
      step = Number(stepRaw);
    }
    let lo: number;
    let hi: number;
    if (range === "*") {
      lo = min;
      hi = max;
    } else if (/^\d+$/.test(range)) {
      lo = Number(range);
      hi = slash >= 0 ? max : lo;
    } else if (/^\d+-\d+$/.test(range)) {
      const [loRaw, hiRaw] = range.split("-");
      lo = Number(loRaw);
      hi = Number(hiRaw);
    } else {
      throw new ScheduleError(`cron ${label} field: unrecognized term "${term}"`);
    }
    if (lo < min || hi > max || lo > hi) {
      throw new ScheduleError(`cron ${label} field: range ${lo}-${hi} outside ${min}-${max}`);
    }
    for (let value = lo; value <= hi; value += step) {
      // day-of-week: 0 and 7 both mean Sunday.
      values.add(label === "day-of-week" && value === 7 ? 0 : value);
    }
  }
  return { values, restricted: raw.trim() !== "*" };
}

function parseCronSpec(raw: string): CronFields {
  const fields = raw.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new ScheduleError(`cron expression needs exactly 5 fields (minute hour day-of-month month day-of-week), got ${fields.length}`);
  }
  const bounds: Array<[string, number, number]> = [
    ["minute", 0, 59],
    ["hour", 0, 23],
    ["day-of-month", 1, 31],
    ["month", 1, 12],
    ["day-of-week", 0, 7],
  ];
  const parsed = fields.map((field, index) => {
    const bound = bounds[index];
    if (bound === undefined) throw new ScheduleError("cron: too many fields");
    const [label, min, max] = bound;
    return parseCronField(field, label, min, max);
  });
  const [minute, hour, dom, month, dow] = parsed;
  if (minute === undefined || hour === undefined || dom === undefined || month === undefined || dow === undefined) {
    throw new ScheduleError("cron expression needs exactly 5 fields");
  }
  return { minute, hour, dom, month, dow };
}

function cronMatches(fields: CronFields, date: Date): boolean {
  if (!fields.minute.values.has(date.getMinutes())) return false;
  if (!fields.hour.values.has(date.getHours())) return false;
  if (!fields.month.values.has(date.getMonth() + 1)) return false;
  const domOk = fields.dom.values.has(date.getDate());
  const dowOk = fields.dow.values.has(date.getDay());
  const { dom, dow } = fields;
  if (dom.restricted && dow.restricted) return domOk || dowOk;
  if (dom.restricted) return domOk;
  if (dow.restricted) return dowOk;
  return true;
}

/**
 * First minute (epoch ms) strictly after `fromMs` matching the cron expression,
 * scanning up to 366 days; null when nothing matches in that window.
 */
export function nextCronRunMs(fields: CronFields, fromMs: number): number | null {
  const capMinutes = 366 * 24 * 60;
  let candidate = Math.floor(fromMs / 60_000) * 60_000 + 60_000;
  for (let i = 0; i < capMinutes; i += 1) {
    if (cronMatches(fields, new Date(candidate))) return candidate;
    candidate += 60_000;
  }
  return null;
}

export function parseSchedule(kind: ScheduleKind, rawSpec: string): ParsedSchedule {
  const spec = rawSpec.trim();
  if (kind === "at") return { kind, spec, atMs: parseAtSpec(spec) };
  if (kind === "every") return { kind, spec, intervalMs: parseDurationMs(spec) };
  return { kind, spec, cronFields: parseCronSpec(spec) };
}

/**
 * Next run time strictly after `fromMs`. For "at" this is the fixed timestamp
 * (caller decides catch-up); for "every" it is fromMs + interval; for "cron" the
 * next matching minute after fromMs (null when none within 366 days).
 */
export function nextRunMs(schedule: ParsedSchedule, fromMs: number): number | null {
  if (schedule.kind === "at") return schedule.atMs ?? null;
  if (schedule.kind === "every") return fromMs + (schedule.intervalMs ?? 0);
  return schedule.cronFields ? nextCronRunMs(schedule.cronFields, fromMs) : null;
}

/**
 * Phase-preserving advance for "every" jobs that missed ≥1 intervals while the
 * gateway was down: the next run stays aligned to the original anchor but lands
 * strictly after `now`. (due <= now is the caller's contract.)
 */
export function advanceEveryMs(intervalMs: number, due: number, now: number): number {
  const missed = Math.floor((now - due) / intervalMs);
  return due + (missed + 1) * intervalMs;
}
// Automation scheduler (M8): a timer loop inside the gateway that fires due jobs
// — running the agent loop with the job prompt and delivering the reply to the
// target chat via the right channel adapter.
// Durability: jobs persist in SQLite; each fire is claimed atomically with a
// last_run guard, so a job can never fire twice for the same scheduled time —
// not across overlapping ticks, not across gateway restarts. On boot, missed
// one-shots ("at") fire once; recurring jobs skip missed intervals without
// firing (advanceAutomation) and resume from the next future slot.

import { runAgentTurn, type AgentRuntime } from "../core/agent.js";
import { advanceEveryMs, nextRunMs, parseSchedule, type ParsedSchedule } from "../core/schedule.js";
import type { AutomationRow, CarapaceStore } from "../storage/sqlite.js";
import type { ChannelAdapter } from "./channels/types.js";

export interface SchedulerOptions {
  store: CarapaceStore;
  agent: AgentRuntime;
  /** Channel adapters used for reply delivery (matched by adapter.name). */
  channels: ChannelAdapter[];
  /** Tick interval in ms (gateway config automations.tickMs, default 30_000). */
  tickMs?: number;
  /** Injectable clock for tests. */
  now?: () => number;
  log?: (line: string) => void;
}

export interface JobOutcome {
  reply: string;
  error: string | null;
}

export interface JobRunResult {
  jobId: string;
  fired: boolean;
  reply?: string;
  error?: string;
}

const DEFAULT_TICK_MS = 30_000;
const DEFAULT_STOP_GRACE_MS = 10_000;

export class Scheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Job ids with a turn in flight — a second tick never re-claims them. */
  private readonly running = new Set<string>();
  private readonly inflight = new Map<string, Promise<JobOutcome>>();

  constructor(private readonly options: SchedulerOptions) {}

  /** Boot: catch up missed recurring runs (without firing), fire due one-shots, start ticking. */
  start(): void {
    if (this.timer !== null) return;
    this.catchUp();
    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.options.tickMs ?? DEFAULT_TICK_MS);
    // Never keep the process alive just for the timer; the HTTP server does that.
    unrefTimer(this.timer);
  }

  /** Stop ticking; wait (bounded) for in-flight job turns to settle. */
  async stop(graceMs: number = DEFAULT_STOP_GRACE_MS): Promise<void> {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.waitUntilIdle(graceMs);
  }

  /** Resolve when no job turns are in flight (bounded); used by stop() and tests. */
  async waitUntilIdle(graceMs: number = DEFAULT_STOP_GRACE_MS): Promise<void> {
    if (this.inflight.size === 0) return;
    const settled = Promise.allSettled([...this.inflight.values()]).then(() => undefined);
    await Promise.race([
      settled,
      new Promise<void>((resolve) => {
        unrefTimer(setTimeout(() => resolve(), graceMs));
      }),
    ]);
  }

  /**
   * One scheduler pass: claim every due job (atomic last_run guard) and run it.
   * Returns the number of jobs claimed.
   */
  async tick(): Promise<number> {
    const now = this.now();
    let fired = 0;
    for (const job of this.options.store.dueAutomations(now)) {
      if (this.running.has(job.id)) continue;
      if (this.claimAndRun(job, now, job.nextRun ?? now)) fired += 1;
    }
    return fired;
  }

  /**
   * Manually fire one job now (CLI `automations run`, tests): claims with
   * due=now regardless of the schedule, then runs + delivers like a tick would.
   */
  async runJob(job: AutomationRow): Promise<JobRunResult> {
    const now = this.now();
    const claimed = this.claimAndRun(job, now, now);
    if (!claimed) {
      return {
        jobId: job.id,
        fired: false,
        error: "job could not be claimed (disabled, invalid schedule, or already fired for this instant)",
      };
    }
    const outcome = await this.inflight.get(job.id);
    if (outcome === undefined) {
      return { jobId: job.id, fired: true, error: "job turn did not report an outcome" };
    }
    return { jobId: job.id, fired: true, reply: outcome.reply, error: outcome.error ?? undefined };
  }

  /** One-line status for boot output and doctor. */
  describe(): string {
    const counts = this.options.store.automationCounts();
    if (counts.total === 0) return "no automations configured";
    const next = this.options.store.nextDueAutomation();
    const due =
      next === null || next.nextRun === null
        ? "none scheduled"
        : `next due "${next.name}" at ${new Date(next.nextRun).toISOString()}`;
    return `${counts.total} job(s) (${counts.enabled} enabled), ${due}`;
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private get now(): () => number {
    return this.options.now ?? (() => Date.now());
  }

  private get log(): (line: string) => void {
    return this.options.log ?? ((line: string) => console.log(`[scheduler] ${line}`));
  }

  /**
   * Gateway-boot catch-up: recurring jobs whose next_run passed while the
   * gateway was down are advanced past `now` without firing — only one-shots
   * ("at") fire for missed times, and they do so through the normal tick.
   */
  private catchUp(): void {
    const now = this.now();
    for (const job of this.options.store.dueAutomations(now)) {
      if (job.kind === "at") continue;
      const schedule = this.safeParse(job);
      if (schedule === null) continue;
      const next =
        job.kind === "every"
          ? advanceEveryMs(schedule.intervalMs ?? 0, job.nextRun ?? now, now)
          : nextRunMs(schedule, now);
      if (next === null || next <= now) {
        this.options.store.setAutomationOutcome(job.id, "error", `schedule "${job.spec}" never fires within 366 days`);
        this.options.store.setAutomationEnabled(job.id, false);
        continue;
      }
      this.options.store.advanceAutomation(job.id, next);
    }
  }

  /**
   * Claim the job for `due` (atomic last_run guard) and launch its turn in the
   * background. The claim happens BEFORE the run: a crash mid-run leaves
   * last_run set, so the job never fires twice for the same time.
   */
  private claimAndRun(job: AutomationRow, now: number, due: number): boolean {
    const schedule = this.safeParse(job);
    if (schedule === null) return false;
    let next: number | null;
    if (job.kind === "at") {
      next = null; // one-shot: the claim is the fire; nothing scheduled after.
    } else if (job.kind === "every") {
      next = advanceEveryMs(schedule.intervalMs ?? 0, due, now);
    } else {
      next = nextRunMs(schedule, now);
      if (next === null) {
        this.options.store.setAutomationOutcome(job.id, "error", `cron "${job.spec}" never fires within 366 days`);
        this.options.store.setAutomationEnabled(job.id, false);
        return false;
      }
    }
    const claimed = this.options.store.claimAutomation(job.id, due, next);
    if (!claimed) return false;
    const task = this.executeJob(job).catch(() => ({ reply: "", error: "job turn crashed" }));
    this.running.add(job.id);
    this.inflight.set(job.id, task);
    void task.then(() => {
      this.running.delete(job.id);
      this.inflight.delete(job.id);
    });
    return true;
  }

  /** Parse the stored schedule; a broken spec marks the job errored + disabled. */
  private safeParse(job: AutomationRow): ParsedSchedule | null {
    try {
      return parseSchedule(job.kind, job.spec);
    } catch (error) {
      this.options.store.setAutomationOutcome(job.id, "error", `invalid schedule "${job.spec}": ${(error as Error).message}`);
      this.options.store.setAutomationEnabled(job.id, false);
      return null;
    }
  }

  /** Run the agent turn for a claimed job, then deliver the reply to its chat. */
  private async executeJob(job: AutomationRow): Promise<JobOutcome> {
    this.log(`automation "${job.name}" (${job.kind} ${job.spec}) firing → ${job.channel}:${job.chatId}`);

    let reply = "";
    let error: string | null = null;
    try {
      const result = await runAgentTurn(
        { sessionId: `automation:${job.id}`, text: job.prompt, channel: job.channel, senderId: "scheduler" },
        this.options.agent,
      );
      reply = result.reply;
    } catch (turnError) {
      error = `agent turn failed: ${(turnError as Error).message}`;
    }

    if (error === null) {
      const adapter = this.options.channels.find((candidate) => candidate.name === job.channel);
      if (adapter === undefined) {
        error = `unknown channel "${job.channel}"`;
      } else if (!adapter.isConfigured()) {
        error = `channel "${job.channel}" is not configured`;
      } else if (adapter.pushCapable === false) {
        error = `channel "${job.channel}" cannot receive proactive pushes`;
      } else {
        try {
          await adapter.send(job.chatId, reply);
        } catch (sendError) {
          error = `delivery failed: ${(sendError as Error).message}`;
        }
      }
    }

    this.options.store.setAutomationOutcome(job.id, error !== null ? "error" : job.kind === "at" ? "done" : "ok", error);
    this.log(error === null ? `automation "${job.name}" completed` : `automation "${job.name}" failed: ${error}`);
    return { reply, error };
  }
}

/** Node timers have unref(); the hand-rolled node types don't declare it. */
function unrefTimer(timer: unknown): void {
  const candidate = timer as { unref?: () => void } | undefined;
  if (candidate !== undefined && typeof candidate.unref === "function") candidate.unref();
}
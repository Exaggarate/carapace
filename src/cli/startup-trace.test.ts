import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CarapaceConfig } from "../config/types.carapace.js";
import { flushDiagnosticsTimeline } from "../infra/diagnostics-timeline.js";
import { createGatewayDispatchStartupTrace } from "./startup-trace.js";

function readTimelineEvents(timelinePath: string): Record<string, unknown>[] {
  flushDiagnosticsTimeline();
  return fs
    .readFileSync(timelinePath, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("CLI startup trace", () => {
  afterEach(() => {
    flushDiagnosticsTimeline();
    vi.unstubAllEnvs();
  });

  it("records entry marks and measured spans in the diagnostics timeline", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "carapace-startup-trace-"));
    const timelinePath = path.join(dir, "timeline.jsonl");
    vi.stubEnv("CARAPACE_DIAGNOSTICS", "timeline");
    vi.stubEnv("CARAPACE_DIAGNOSTICS_TIMELINE_PATH", timelinePath);

    const trace = createGatewayDispatchStartupTrace(
      ["node", "carapace", "agent", "--local"],
      "entry",
    );
    trace.mark("bootstrap");
    await trace.measure("run-main-import", async () => {
      await Promise.resolve();
    });
    await expect(
      trace.measure("command-execution", async () => "done", { timeline: false }),
    ).resolves.toBe("done");

    const events = readTimelineEvents(timelinePath);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "mark",
          name: "entry.bootstrap",
          phase: "cli.startup",
          durationMs: expect.any(Number),
          attributes: expect.objectContaining({ totalMs: expect.any(Number) }),
        }),
        expect.objectContaining({
          type: "span.start",
          name: "entry.run-main-import",
          phase: "cli.startup",
        }),
        expect.objectContaining({
          type: "span.end",
          name: "entry.run-main-import",
          phase: "cli.startup",
          durationMs: expect.any(Number),
        }),
      ]),
    );
    expect(events).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "entry.command-execution",
        }),
      ]),
    );
  });

  it("flushes buffered startup phases when config enables the timeline", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "carapace-startup-trace-config-"));
    const timelinePath = path.join(dir, "timeline.jsonl");
    vi.stubEnv("CARAPACE_DIAGNOSTICS", "");
    vi.stubEnv("CARAPACE_DIAGNOSTICS_TIMELINE_PATH", timelinePath);

    const trace = createGatewayDispatchStartupTrace(
      ["node", "carapace", "agent", "--local"],
      "entry",
    );
    trace.mark("bootstrap");
    await trace.measure("run-main-import", async () => "loaded");

    expect(await trace.requiresDiagnosticsConfig()).toBe(true);
    expect(fs.existsSync(timelinePath)).toBe(false);

    await trace.configureDiagnosticsTimeline({
      diagnostics: { flags: ["timeline"] },
    } as CarapaceConfig);

    expect(readTimelineEvents(timelinePath)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "mark",
          name: "entry.bootstrap",
          phase: "cli.startup",
        }),
        expect.objectContaining({
          type: "span.end",
          name: "entry.run-main-import",
          phase: "cli.startup",
          durationMs: expect.any(Number),
        }),
      ]),
    );
  });
});

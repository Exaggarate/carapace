import {
  formatRuntimeCacheCount,
  formatRuntimeCacheHitPercent,
} from "./agentic-parity-cache-usage.js";
import type { QaRuntimeParityReport } from "./agentic-parity-runtime-report-contract.js";
import type { RuntimeParityCacheDiagnostics } from "./runtime-parity-cache-diagnostics.js";
import { formatRuntimeSpeedComparison, formatRuntimeWallClockMs } from "./runtime-parity-timing.js";

function formatRuntimeCacheMisses(diagnostics: RuntimeParityCacheDiagnostics | undefined): string {
  if (!diagnostics) {
    return "N/A";
  }
  if (diagnostics.cacheTelemetryTurns === 0) {
    return diagnostics.unmeasuredPostWarmTurns.length > 0
      ? `N/A (unmeasured turns ${diagnostics.unmeasuredPostWarmTurns.join(", ")})`
      : "N/A";
  }
  const measuredMisses =
    diagnostics.cacheMisses.length === 0
      ? "none"
      : diagnostics.cacheMisses
          .map((miss) => `turn ${miss.turn} (${miss.inputTokens} uncached input)`)
          .join(", ");
  if (diagnostics.unmeasuredPostWarmTurns.length === 0) {
    return measuredMisses;
  }
  const unknownTurns = `unmeasured turns ${diagnostics.unmeasuredPostWarmTurns.join(", ")}`;
  return measuredMisses === "none" ? `N/A (${unknownTurns})` : `${measuredMisses}; ${unknownTurns}`;
}

export function renderQaRuntimeParityMarkdownReport(report: QaRuntimeParityReport): string {
  const lines = [
    `# Carapace Runtime Parity Report — ${report.runtimePair[0]} vs ${report.runtimePair[1]}`,
    "",
    `- Compared at: ${report.comparedAt}`,
    `- Provider mode: ${report.providerMode ?? "unknown"}`,
    `- Primary model: ${report.primaryModel ?? "unknown"}`,
    `- Verdict: ${report.pass ? "pass" : "fail"}`,
    "",
    "## Aggregate Metrics",
    "",
    "| Metric | Value |",
    "| --- | ---: |",
    `| Total scenarios | ${report.totalScenarios} |`,
    `| Passed scenarios | ${report.passedScenarios} |`,
    `| Failed scenarios | ${report.failedScenarios} |`,
    `| No drift | ${report.driftCounts.none} |`,
    `| Text-only drift | ${report.driftCounts["text-only"]} |`,
    `| Tool-call-shape drift | ${report.driftCounts["tool-call-shape"]} |`,
    `| Tool-result-shape drift | ${report.driftCounts["tool-result-shape"]} |`,
    `| Structural drift | ${report.driftCounts.structural} |`,
    `| Failure-mode drift | ${report.driftCounts["failure-mode"]} |`,
    "",
    "## Prompt Cache",
    "",
    "| Runtime | Gross input | Uncached input | Cached input | Cache writes | Output | Total tokens | Cache hit |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    `| carapace | ${formatRuntimeCacheCount(report.usage.carapace?.grossInputTokens)} | ${formatRuntimeCacheCount(report.usage.carapace?.uncachedInputTokens)} | ${formatRuntimeCacheCount(report.usage.carapace?.cachedInputTokens)} | ${formatRuntimeCacheCount(report.usage.carapace?.cacheWriteTokens)} | ${formatRuntimeCacheCount(report.usage.carapace?.outputTokens)} | ${formatRuntimeCacheCount(report.usage.carapace?.totalTokens)} | ${formatRuntimeCacheHitPercent(report.usage.carapace?.cacheHitPercent)} |`,
    `| codex | ${formatRuntimeCacheCount(report.usage.codex?.grossInputTokens)} | ${formatRuntimeCacheCount(report.usage.codex?.uncachedInputTokens)} | ${formatRuntimeCacheCount(report.usage.codex?.cachedInputTokens)} | ${formatRuntimeCacheCount(report.usage.codex?.cacheWriteTokens)} | ${formatRuntimeCacheCount(report.usage.codex?.outputTokens)} | ${formatRuntimeCacheCount(report.usage.codex?.totalTokens)} | ${formatRuntimeCacheHitPercent(report.usage.codex?.cacheHitPercent)} |`,
    "",
    "## Runtime Timing",
    "",
    "| Runtime | Total wall time | p50 per scenario | p90 per scenario |",
    "| --- | ---: | ---: | ---: |",
    `| carapace | ${formatRuntimeWallClockMs(report.timing.carapace.totalWallClockMs)} | ${formatRuntimeWallClockMs(report.timing.carapace.p50WallClockMs)} | ${formatRuntimeWallClockMs(report.timing.carapace.p90WallClockMs)} |`,
    `| codex | ${formatRuntimeWallClockMs(report.timing.codex.totalWallClockMs)} | ${formatRuntimeWallClockMs(report.timing.codex.p50WallClockMs)} | ${formatRuntimeWallClockMs(report.timing.codex.p90WallClockMs)} |`,
    "",
    `- Faster runtime: ${formatRuntimeSpeedComparison(report.timing)}`,
    "",
  ];
  if (report.timing.bootstrap) {
    lines.push(
      "## Gateway Bootstrap (Excluded From Runtime Timing)",
      "",
      "| Runtime | Total bootstrap | p50 per scenario | p90 per scenario |",
      "| --- | ---: | ---: | ---: |",
      `| carapace | ${formatRuntimeWallClockMs(report.timing.bootstrap.carapace.totalWallClockMs)} | ${formatRuntimeWallClockMs(report.timing.bootstrap.carapace.p50WallClockMs)} | ${formatRuntimeWallClockMs(report.timing.bootstrap.carapace.p90WallClockMs)} |`,
      `| codex | ${formatRuntimeWallClockMs(report.timing.bootstrap.codex.totalWallClockMs)} | ${formatRuntimeWallClockMs(report.timing.bootstrap.codex.p50WallClockMs)} | ${formatRuntimeWallClockMs(report.timing.bootstrap.codex.p90WallClockMs)} |`,
      "",
    );
  }
  if (report.failures.length > 0) {
    lines.push("## Gate Failures", "");
    for (const failure of report.failures) {
      lines.push(`- ${failure}`);
    }
    lines.push("");
  }
  lines.push("## Scenario Comparison", "");
  for (const scenario of report.scenarios) {
    const usageNotApplicable = scenario.runtimeParityUsage.expectation === "not-applicable";
    const carapaceTokens = usageNotApplicable ? "N/A" : String(scenario.carapaceTokens);
    const codexTokens = usageNotApplicable ? "N/A" : String(scenario.codexTokens);
    lines.push(`### ${scenario.name}`, "");
    lines.push(`- status: ${scenario.status}`);
    lines.push(`- drift: ${scenario.drift}`);
    lines.push(
      `- carapace: ${scenario.carapaceStatus} (${scenario.carapaceToolCalls} tool calls, ${carapaceTokens} tokens)`,
    );
    lines.push(
      `- codex: ${scenario.codexStatus} (${scenario.codexToolCalls} tool calls, ${codexTokens} tokens)`,
    );
    lines.push(
      `- wall time: carapace ${formatRuntimeWallClockMs(scenario.carapaceWallClockMs)}; codex ${formatRuntimeWallClockMs(scenario.codexWallClockMs)}; ${formatRuntimeSpeedComparison(scenario)}`,
    );
    if (
      scenario.carapaceBootstrapWallClockMs !== undefined ||
      scenario.codexBootstrapWallClockMs !== undefined
    ) {
      lines.push(
        `- gateway bootstrap (excluded): carapace ${formatRuntimeWallClockMs(scenario.carapaceBootstrapWallClockMs ?? null)}; codex ${formatRuntimeWallClockMs(scenario.codexBootstrapWallClockMs ?? null)}`,
      );
    }
    lines.push(
      `- prompt cache: carapace ${formatRuntimeCacheHitPercent(scenario.carapaceUsage?.cacheHitPercent)} (${formatRuntimeCacheCount(scenario.carapaceUsage?.cachedInputTokens)} cached, ${formatRuntimeCacheCount(scenario.carapaceUsage?.uncachedInputTokens)} uncached input); codex ${formatRuntimeCacheHitPercent(scenario.codexUsage?.cacheHitPercent)} (${formatRuntimeCacheCount(scenario.codexUsage?.cachedInputTokens)} cached, ${formatRuntimeCacheCount(scenario.codexUsage?.uncachedInputTokens)} uncached input)`,
    );
    lines.push(
      `- post-warm cache misses: carapace ${formatRuntimeCacheMisses(scenario.carapaceCacheDiagnostics)}; codex ${formatRuntimeCacheMisses(scenario.codexCacheDiagnostics)}`,
    );
    if (scenario.runtimeParityUsage.expectation === "not-applicable") {
      lines.push(`- assistant-message usage: N/A (${scenario.runtimeParityUsage.reason})`);
    }
    if (scenario.driftDetails) {
      lines.push(`- details: ${scenario.driftDetails}`);
    }
    lines.push("");
  }
  lines.push("## Notes", "");
  for (const note of report.notes) {
    lines.push(`- ${note}`);
  }
  lines.push("");
  return lines.join("\n");
}

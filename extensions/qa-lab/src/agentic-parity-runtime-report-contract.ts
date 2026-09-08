import type { QaRuntimeParityCacheUsage } from "./agentic-parity-cache-usage.js";
import type { RuntimeParityCacheDiagnostics } from "./runtime-parity-cache-diagnostics.js";
import type { QaRuntimeTiming } from "./runtime-parity-timing.js";
import type { RuntimeId, RuntimeParityDrift, RuntimeParityUsagePolicy } from "./runtime-parity.js";

export type QaRuntimeParityScenarioReport = {
  name: string;
  status: "pass" | "fail";
  runtimeParityUsage: RuntimeParityUsagePolicy;
  drift: RuntimeParityDrift | "missing";
  driftDetails?: string;
  carapaceStatus: "pass" | "fail" | "missing";
  codexStatus: "pass" | "fail" | "missing";
  carapaceTokens: number;
  codexTokens: number;
  carapaceUsage: QaRuntimeParityCacheUsage | null;
  codexUsage: QaRuntimeParityCacheUsage | null;
  carapaceCacheDiagnostics?: RuntimeParityCacheDiagnostics;
  codexCacheDiagnostics?: RuntimeParityCacheDiagnostics;
  carapaceToolCalls: number;
  codexToolCalls: number;
  carapaceWallClockMs: number | null;
  codexWallClockMs: number | null;
  carapaceBootstrapWallClockMs?: number;
  codexBootstrapWallClockMs?: number;
  fasterRuntime: RuntimeId | "tie" | null;
  speedupPercent: number | null;
};

export type QaRuntimeParityReport = {
  runtimePair: [RuntimeId, RuntimeId];
  comparedAt: string;
  providerMode?: string;
  primaryModel?: string;
  totalScenarios: number;
  passedScenarios: number;
  failedScenarios: number;
  driftCounts: Record<RuntimeParityDrift, number>;
  scenarios: QaRuntimeParityScenarioReport[];
  timing: QaRuntimeTiming;
  usage: {
    carapace: QaRuntimeParityCacheUsage | null;
    codex: QaRuntimeParityCacheUsage | null;
  };
  pass: boolean;
  failures: string[];
  notes: string[];
};

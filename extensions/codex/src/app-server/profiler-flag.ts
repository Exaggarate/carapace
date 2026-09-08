/**
 * Resolves whether Codex app-server profiling instrumentation is enabled by
 * Carapace diagnostic flags.
 */
import type { CarapaceConfig } from "carapace/plugin-sdk/config-contracts";
import { isDiagnosticFlagEnabled } from "carapace/plugin-sdk/diagnostic-flags";

const PROFILER_FLAGS = ["profiler", "codex.profiler"] as const;

/** Checks the generic and Codex-specific profiler diagnostic flags. */
export function isCodexAppServerProfilerEnabled(
  config?: CarapaceConfig,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return PROFILER_FLAGS.some((flag) => isDiagnosticFlagEnabled(flag, config, env));
}

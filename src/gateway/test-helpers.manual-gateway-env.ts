import path from "node:path";
import { setTestEnvValue } from "../test-utils/env.js";
import { GATEWAY_STARTUP_MUTATED_ENV_KEYS } from "./test-helpers.env.js";

const MANUAL_GATEWAY_BACKGROUND_ENV_KEYS = [
  "CARAPACE_SKIP_BROWSER_CONTROL_SERVER",
  "CARAPACE_SKIP_GMAIL_WATCHER",
  "CARAPACE_SKIP_CANVAS_HOST",
  "CARAPACE_SKIP_CHANNELS",
  "CARAPACE_SKIP_PROVIDERS",
  "CARAPACE_SKIP_CRON",
  "CARAPACE_DISABLE_BUNDLED_PLUGINS",
  "CARAPACE_BUNDLED_PLUGINS_DIR",
] as const;

export const MANUAL_GATEWAY_ENV_KEYS = [
  ...GATEWAY_STARTUP_MUTATED_ENV_KEYS,
  ...MANUAL_GATEWAY_BACKGROUND_ENV_KEYS,
] as const;

/** Keeps manual RPC suites on the real core Gateway without unrelated startup work. */
export function configureManualGatewayBackgroundEnv(tempHome: string): void {
  setTestEnvValue("CARAPACE_SKIP_BROWSER_CONTROL_SERVER", "1");
  setTestEnvValue("CARAPACE_SKIP_GMAIL_WATCHER", "1");
  setTestEnvValue("CARAPACE_SKIP_CANVAS_HOST", "1");
  setTestEnvValue("CARAPACE_SKIP_CHANNELS", "1");
  setTestEnvValue("CARAPACE_SKIP_PROVIDERS", "1");
  setTestEnvValue("CARAPACE_SKIP_CRON", "1");
  setTestEnvValue("CARAPACE_DISABLE_BUNDLED_PLUGINS", "1");
  setTestEnvValue("CARAPACE_BUNDLED_PLUGINS_DIR", path.join(tempHome, "no-plugins"));
}

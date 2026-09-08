import os from "node:os";
import path from "node:path";

// Validation never creates or writes this state dir: no operator DB is opened,
// and no operator-installed plugin can leak config keys into the checkout's audit.
export function resolveRepoBundledPluginEnv(bundledPluginsDir: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    CARAPACE_STATE_DIR: path.join(os.tmpdir(), "carapace-repo-bundled-plugin-state"),
    CARAPACE_BUNDLED_PLUGINS_DIR: bundledPluginsDir,
  };
}

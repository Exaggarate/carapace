import { fileURLToPath } from "node:url";
import { definePluginEntry, type CarapacePluginService } from "carapace/plugin-sdk/plugin-entry";
import { createCrabboxWorkerProvider, resolveCarapaceRoot } from "./src/crabbox-worker-provider.js";

const workerWallpaperPath = fileURLToPath(
  new URL("./assets/carapace-worker-wallpaper.png", import.meta.url),
);

export default definePluginEntry({
  id: "crabbox",
  name: "Crabbox Worker Provider",
  description: "Cloud worker provider backed by the Crabbox CLI",
  register(api) {
    api.registerCli(
      async ({ program }) => {
        const { registerCrabboxWarmImageCommands } =
          await import("./src/crabbox-worker-warm-image-cli.js");
        registerCrabboxWarmImageCommands(program);
      },
      {
        descriptors: [
          {
            name: "crabbox",
            description: "Inspect and recover Crabbox warm images",
            hasSubcommands: true,
          },
        ],
      },
    );
    const provider = createCrabboxWorkerProvider({
      carapaceRoot: resolveCarapaceRoot(api.rootDir),
      wallpaperPath: workerWallpaperPath,
      warn: (message) => api.logger.warn(message),
    });
    api.registerWorkerProvider(provider);
    // Worker sidecars stop first; plugin services own generation-wide heartbeat cleanup.
    api.registerService({
      id: "crabbox-worker-cleanup",
      start() {},
      stop() {
        return provider.dispose();
      },
    } satisfies CarapacePluginService);
  },
});

// Matrix plugin module implements cli metadata behavior.
import type { CarapacePluginApi } from "carapace/plugin-sdk/channel-plugin-common";

export function registerMatrixCliMetadata(api: CarapacePluginApi) {
  api.registerCli(
    async ({ program }) => {
      const { registerMatrixCli } = await import("./cli.js");
      registerMatrixCli({ program });
    },
    {
      descriptors: [
        {
          name: "matrix",
          description: "Manage Matrix accounts, verification, devices, and profile state",
          hasSubcommands: true,
        },
      ],
    },
  );
}

import fs from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { CarapaceConfig } from "../config/types.carapace.js";
import { withCarapaceTestState } from "../test-utils/carapace-test-state.js";
import { commitConfigWithPendingPluginInstalls } from "./install-record-commit.js";

describe("committed plugin configuration", () => {
  it.each([false, true])(
    "returns the persisted configuration (pending records: %s)",
    async (pending) => {
      await withCarapaceTestState({ label: "committed-plugin-config" }, async (state) => {
        await state.writeConfig({ gateway: { mode: "local" } });
        const nextConfig: CarapaceConfig = {
          gateway: { mode: "local" },
          ...(pending
            ? {
                plugins: {
                  installs: { fixture: { source: "npm" as const, spec: "fixture@1.0.0" } },
                },
              }
            : {}),
        };

        const result = await commitConfigWithPendingPluginInstalls({ nextConfig });
        const persisted = JSON.parse(await fs.readFile(state.configPath, "utf8"));

        expect(result.config).toEqual(persisted);
        expect(result.config.meta?.lastTouchedVersion).toEqual(expect.any(String));
        expect(result.movedInstallRecords).toBe(pending);
        expect(result.config.plugins?.installs).toBeUndefined();
      });
    },
  );
});

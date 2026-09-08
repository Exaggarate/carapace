// Carapace live rescue channel tests cover live-channel rescue message delivery.
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CommandContext } from "../auto-reply/reply/commands-types.js";
import { clearConfigCache } from "../config/config.js";
import type { CarapaceConfig } from "../config/types.carapace.js";
import { isTruthyEnvValue } from "../infra/env.js";
import { resetPluginStateStoreForTests } from "../plugin-state/plugin-state-store.js";
import { withTestDir } from "../test-helpers/temp-dir.js";
import { deleteTestEnvValue, setTestEnvValue } from "../test-utils/env.js";
import { listSystemAgentAuditEntriesForTests } from "./audit.test-support.js";
import { runSystemAgentRescueMessage } from "./rescue-message.js";

const originalStateDir = process.env.CARAPACE_STATE_DIR;
const originalConfigPath = process.env.CARAPACE_CONFIG_PATH;

const runLive =
  isTruthyEnvValue(process.env.CARAPACE_LIVE_TEST) &&
  isTruthyEnvValue(process.env.CARAPACE_LIVE_SYSTEM_AGENT_RESCUE_CHANNEL);
const describeLive = runLive ? describe : describe.skip;

function commandContext(channel = process.env.CARAPACE_LIVE_SYSTEM_AGENT_CHANNEL ?? "whatsapp") {
  return {
    surface: channel,
    channel,
    channelId: channel,
    ownerList: ["user:owner"],
    senderIsOwner: true,
    isAuthorizedSender: true,
    senderId: "user:owner",
    rawBodyNormalized: "/carapace status",
    commandBodyNormalized: "/carapace status",
    from: "user:owner",
    to: "account:default",
  } satisfies CommandContext;
}

async function runRescue(params: {
  commandBody: string;
  cfg: CarapaceConfig;
  ctx?: CommandContext;
}) {
  const ctx = params.ctx ?? commandContext();
  return await runSystemAgentRescueMessage({
    cfg: params.cfg,
    command: { ...ctx, commandBodyNormalized: params.commandBody },
    commandBody: params.commandBody,
    isGroup: false,
  });
}

describeLive("Carapace live rescue channel smoke", () => {
  afterEach(() => {
    resetPluginStateStoreForTests();
    clearConfigCache();
    if (originalStateDir === undefined) {
      deleteTestEnvValue("CARAPACE_STATE_DIR");
    } else {
      setTestEnvValue("CARAPACE_STATE_DIR", originalStateDir);
    }
    if (originalConfigPath === undefined) {
      deleteTestEnvValue("CARAPACE_CONFIG_PATH");
    } else {
      setTestEnvValue("CARAPACE_CONFIG_PATH", originalConfigPath);
    }
  });

  it("handles /carapace status and a persistent approval roundtrip", async () => {
    await withTestDir({ prefix: "carapace-live-rescue-" }, async (tempDir) => {
      const configPath = path.join(tempDir, "carapace.json");
      setTestEnvValue("CARAPACE_STATE_DIR", tempDir);
      setTestEnvValue("CARAPACE_CONFIG_PATH", configPath);
      await fs.writeFile(
        configPath,
        JSON.stringify(
          {
            meta: { lastTouchedVersion: "live-test", lastTouchedAt: new Date(0).toISOString() },
            agents: { defaults: {} },
            tools: { exec: { mode: "full" } },
          },
          null,
          2,
        ),
      );

      const cfg: CarapaceConfig = {
        tools: { exec: { mode: "full" } },
      };

      await expect(runRescue({ commandBody: "/carapace status", cfg })).resolves.toContain(
        "[carapace] done: status.check",
      );
      await expect(
        runRescue({ commandBody: "/carapace set default model openai/gpt-5.5", cfg }),
      ).resolves.toContain("Reply /carapace yes to apply");
      await expect(runRescue({ commandBody: "/carapace yes", cfg })).resolves.toContain(
        "Default model: openai/gpt-5.5",
      );

      const config = JSON.parse(await fs.readFile(configPath, "utf8")) as CarapaceConfig;
      const defaultModel = config.agents?.defaults?.model;
      if (!defaultModel || typeof defaultModel !== "object") {
        throw new Error("expected default model object");
      }
      expect(defaultModel.primary).toBe("openai/gpt-5.5");
      expect(
        listSystemAgentAuditEntriesForTests().some(
          (entry) => entry.value.operation === "config.setDefaultModel",
        ),
      ).toBe(true);
    });
  });
});

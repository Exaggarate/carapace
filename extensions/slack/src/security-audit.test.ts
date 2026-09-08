import type { CarapaceConfig } from "carapace/plugin-sdk/config-contracts";
// Slack tests cover security audit plugin behavior.
import { describe, expect, it, vi } from "vitest";
import type { ResolvedSlackAccount } from "./accounts.js";
import { collectSlackSecurityAuditFindings } from "./security-audit.js";

const { readChannelAllowFromStoreMock } = vi.hoisted(() => ({
  readChannelAllowFromStoreMock: vi.fn(async () => [] as string[]),
}));

vi.mock("carapace/plugin-sdk/conversation-runtime", () => ({
  readChannelAllowFromStore: readChannelAllowFromStoreMock,
}));

function createSlackAccount(config: NonNullable<CarapaceConfig["channels"]>["slack"]) {
  return {
    accountId: "default",
    enabled: true,
    botToken: "xoxb-test",
    botTokenSource: "config",
    appTokenSource: "config",
    config,
  } as ResolvedSlackAccount;
}

function createSlashCommandSlackConfig(): CarapaceConfig {
  return {
    channels: {
      slack: {
        enabled: true,
        botToken: "xoxb-test",
        appToken: "xapp-test",
        groupPolicy: "open",
        slashCommand: { enabled: true },
      },
    },
  };
}

async function collectSlackFindingsForConfig(cfg: CarapaceConfig) {
  readChannelAllowFromStoreMock.mockResolvedValue([]);
  return await collectSlackSecurityAuditFindings({
    cfg,
    account: createSlackAccount(cfg.channels!.slack),
    accountId: "default",
  });
}

describe("Slack security audit findings", () => {
  it("flags slash commands without a channel users allowlist", async () => {
    const findings = await collectSlackFindingsForConfig(createSlashCommandSlackConfig());

    const slashAllowlistFinding = findings.find(
      ({ checkId }) => checkId === "channels.slack.commands.slash.no_allowlists",
    );
    expect(slashAllowlistFinding?.severity).toBe("warn");
  });
});

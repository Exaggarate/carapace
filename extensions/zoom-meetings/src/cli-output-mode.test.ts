import { Command } from "commander";
import type { CarapacePluginApi } from "carapace/plugin-sdk/plugin-entry";
import { createTestPluginApi } from "carapace/plugin-sdk/plugin-test-api";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("carapace/plugin-sdk/meeting-runtime");
  vi.resetModules();
});

describe("Zoom meetings CLI output mode", () => {
  it("loads and registers metadata without the meeting runtime", async () => {
    vi.resetModules();
    vi.doMock("carapace/plugin-sdk/meeting-runtime", () => {
      throw new Error("CLI metadata must not load the meeting runtime");
    });
    const { default: metadata } = await import("../cli-metadata.js");
    const registerCli = vi.fn<CarapacePluginApi["registerCli"]>();
    const api = createTestPluginApi({ registerCli });
    metadata.register(api);

    expect(metadata).toMatchObject({
      id: "zoom-meetings",
      name: "Zoom meetings",
      description: "Zoom meetings CLI metadata",
    });
    expect(registerCli).toHaveBeenCalledExactlyOnceWith(expect.any(Function), {
      descriptors: [
        {
          name: "zoommeetings",
          description: "Join and manage Zoom meeting guests",
          hasSubcommands: true,
          machineOutput: expect.any(Function),
        },
      ],
    });
    const program = new Command();
    for (const [register] of registerCli.mock.calls) {
      await register({ program, parentPath: [], config: {}, logger: api.logger });
    }
    expect(program.commands).toEqual([]);

    const isMachineOutput = metadata.descriptor.machineOutput;
    expect(isMachineOutput({ argv: ["node", "carapace", "zoommeetings", "status"] })).toBe(true);
    expect(isMachineOutput({ argv: ["node", "carapace", "zoommeetings"] })).toBe(false);
    expect(
      isMachineOutput({
        argv: ["node", "carapace", "zoommeetings", "--log-level", "debug", "future-action"],
      }),
    ).toBe(true);
  });
});

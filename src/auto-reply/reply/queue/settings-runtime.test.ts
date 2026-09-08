// Tests runtime queue settings with mocked provider fallback state.
import { describe, expect, it, vi } from "vitest";
import type { CarapaceConfig } from "../../../config/types.carapace.js";

const getLoadedChannelPluginMock = vi.hoisted(() => vi.fn());

vi.mock("../../../channels/plugins/index.js", () => ({
  getLoadedChannelPlugin: getLoadedChannelPluginMock,
}));

describe("resolveQueueSettings runtime defaults", () => {
  it("uses defaults from already-loaded channel plugins", async () => {
    getLoadedChannelPluginMock.mockReturnValueOnce({
      defaults: {
        queue: {
          debounceMs: 125,
        },
      },
    });
    const { resolveQueueSettings } = await import("./settings-runtime.js");

    expect(resolveQueueSettings({ cfg: {} as CarapaceConfig, channel: "demo" })).toEqual({
      mode: "steer",
      debounceMs: 125,
      cap: 20,
      dropPolicy: "summarize",
    });
    expect(getLoadedChannelPluginMock).toHaveBeenCalledWith("demo");
  });

  it("falls back without loading bundled channel plugins", async () => {
    getLoadedChannelPluginMock.mockReturnValueOnce(undefined);
    const { resolveQueueSettings } = await import("./settings-runtime.js");

    expect(resolveQueueSettings({ cfg: {} as CarapaceConfig, channel: "telegram" })).toEqual({
      mode: "steer",
      debounceMs: 500,
      cap: 20,
      dropPolicy: "summarize",
    });
    expect(getLoadedChannelPluginMock).toHaveBeenCalledWith("telegram");
  });
});

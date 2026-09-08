// Tests queue setting normalization and directive parsing.
import { describe, expect, it } from "vitest";
import type { CarapaceConfig } from "../../../config/types.carapace.js";
import { resolveQueueSettingsCore } from "./settings.js";

describe("resolveQueueSettingsCore", () => {
  it("defaults inbound channels to steering settings", () => {
    expect(resolveQueueSettingsCore({ cfg: {} as CarapaceConfig })).toEqual({
      mode: "steer",
      debounceMs: 500,
      cap: 20,
      dropPolicy: "summarize",
    });
  });

  it("uses the short debounce when collect is selected globally", () => {
    expect(
      resolveQueueSettingsCore({
        cfg: {
          messages: {
            queue: {
              mode: "collect",
            },
          },
        } as CarapaceConfig,
      }),
    ).toEqual({
      mode: "collect",
      debounceMs: 500,
      cap: 20,
      dropPolicy: "summarize",
    });
  });

  it("keeps explicit channel queue overrides ahead of defaults", () => {
    expect(
      resolveQueueSettingsCore({
        cfg: {
          messages: {
            queue: {
              mode: "followup",
              byChannel: {
                discord: "collect",
              },
            },
          },
        } as CarapaceConfig,
        channel: "discord",
      }),
    ).toEqual({
      mode: "collect",
      debounceMs: 500,
      cap: 20,
      dropPolicy: "summarize",
    });
  });

  it("uses explicit steer mode from config", () => {
    expect(
      resolveQueueSettingsCore({
        cfg: {
          messages: {
            queue: {
              mode: "steer",
            },
          },
        } as CarapaceConfig,
      }),
    ).toEqual({
      mode: "steer",
      debounceMs: 500,
      cap: 20,
      dropPolicy: "summarize",
    });
  });

  it("ignores removed steering queue modes from stale config", () => {
    expect(
      resolveQueueSettingsCore({
        cfg: {
          messages: {
            queue: {
              mode: "steer-backlog" as never,
            },
          },
        } as CarapaceConfig,
      }),
    ).toEqual({
      mode: "steer",
      debounceMs: 500,
      cap: 20,
      dropPolicy: "summarize",
    });
  });

  it("maps retired persisted session queue modes to compatible modes", () => {
    expect(
      resolveQueueSettingsCore({
        cfg: {} as CarapaceConfig,
        sessionEntry: { sessionId: "test-session", updatedAt: 0, queueMode: "queue" as never },
      }).mode,
    ).toBe("steer");
    expect(
      resolveQueueSettingsCore({
        cfg: {} as CarapaceConfig,
        sessionEntry: {
          sessionId: "test-session",
          updatedAt: 0,
          queueMode: "steer-backlog" as never,
        },
      }).mode,
    ).toBe("followup");
    expect(
      resolveQueueSettingsCore({
        cfg: {} as CarapaceConfig,
        sessionEntry: {
          sessionId: "test-session",
          updatedAt: 0,
          queueMode: "steer+backlog" as never,
        },
      }).mode,
    ).toBe("followup");
  });
});

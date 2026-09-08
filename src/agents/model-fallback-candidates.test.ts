import { describe, expect, it } from "vitest";
import type { CarapaceConfig } from "../config/types.carapace.js";
import { createWarnLogCapture } from "../logging/test-helpers/warn-log-capture.js";
import { resolveImageFallbackCandidates } from "./model-fallback-candidates.js";

describe("resolveImageFallbackCandidates", () => {
  it("records unresolved configured entries without changing the resolved chain", async () => {
    const warnLogs = createWarnLogCapture("carapace-image-fallback-candidates-test");
    const cfg = {
      agents: {
        defaults: {
          imageModel: {
            primary: "openai/",
            fallbacks: ["anthropic/claude-sonnet-4-6", "/vision"],
          },
        },
      },
    } as CarapaceConfig;

    try {
      expect(
        resolveImageFallbackCandidates({
          cfg,
          defaultProvider: "openai",
        }),
      ).toEqual([
        {
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          routeOrigin: "configured-fallback",
          routeResolution: "resolved",
        },
      ]);
      expect(
        await warnLogs.findText(
          'Unresolved image model "openai/"; skipped configured-primary candidate.',
        ),
      ).toBeDefined();
      expect(
        await warnLogs.findText(
          'Unresolved image model "/vision"; skipped configured-fallback candidate.',
        ),
      ).toBeDefined();
    } finally {
      warnLogs.cleanup();
    }
  });

  it("does not warn for resolved configured entries", async () => {
    const warnLogs = createWarnLogCapture("carapace-image-fallback-candidates-test");
    const cfg = {
      agents: {
        defaults: {
          imageModel: {
            primary: "openai/gpt-5.4",
            fallbacks: ["anthropic/claude-sonnet-4-6"],
          },
        },
      },
    } as CarapaceConfig;

    try {
      expect(
        resolveImageFallbackCandidates({
          cfg,
          defaultProvider: "openai",
        }),
      ).toHaveLength(2);
      expect(await warnLogs.findText("Unresolved image model")).toBeUndefined();
    } finally {
      warnLogs.cleanup();
    }
  });
});

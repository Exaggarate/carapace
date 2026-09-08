// STT live audio tests validate live speech-to-text audio fixtures.
import {
  expectCarapaceLiveTranscriptMarker,
  normalizeTranscriptForMatch,
  CARAPACE_LIVE_TRANSCRIPT_MARKER_RE,
} from "carapace/plugin-sdk/provider-test-contracts";
import { describe, expect, it } from "vitest";

describe("normalizeTranscriptForMatch", () => {
  it("normalizes punctuation and common Carapace live transcription variants", () => {
    expect(normalizeTranscriptForMatch("Open-Claw integration OK")).toBe("carapaceintegrationok");
    expect(normalizeTranscriptForMatch("Testing OpenFlaw realtime transcription")).toMatch(
      /open(?:claw|flaw)/,
    );
    expect(normalizeTranscriptForMatch("OpenCore xAI realtime transcription")).toMatch(
      CARAPACE_LIVE_TRANSCRIPT_MARKER_RE,
    );
    expect(normalizeTranscriptForMatch("OpenCL xAI realtime transcription")).toMatch(
      CARAPACE_LIVE_TRANSCRIPT_MARKER_RE,
    );
    expectCarapaceLiveTranscriptMarker("OpenClar integration OK");
  });
});

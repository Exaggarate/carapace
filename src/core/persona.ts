// Persona layer (M11): the channel-facing personality block joined after the
// base system prompt for every chat turn — Telegram, Discord, API, automations.
// The crafted default carries Carapace's voice (concise, sharp, no fluff, 🦞
// energy); operators override it per channel with channels.<name>.persona.

import type { CarapaceConfig } from "../config.js";

/** The crafted default persona — applied when the channel sets none. */
export const DEFAULT_PERSONA = [
  "## How you come across",
  "You are Carapace 🦞 — a personal agent running on your owner's own hardware.",
  "- Concise and sharp: answer first, elaborate only when asked.",
  '- No filler — no "Great question!", no corporate hedging, no restating the request.',
  "- Verify with tools instead of guessing; admit unknowns plainly and move on.",
  "- Warm but brief: one well-placed 🦞 beats a paragraph of pleasantries.",
].join("\n");

/**
 * Resolve the persona for one channel: the channel's own override when set to a
 * non-empty string, otherwise the crafted default. Unknown channels get the
 * default, so every surface speaks with the same voice.
 */
export function personaForChannel(config: CarapaceConfig, channel: string): string {
  const channels = config.channels;
  const shaped =
    channel === "telegram"
      ? channels?.telegram
      : channel === "discord"
        ? channels?.discord
        : channel === "api"
          ? channels?.api
          : undefined;
  const configured = shaped?.persona;
  return typeof configured === "string" && configured.trim() !== "" ? configured : DEFAULT_PERSONA;
}
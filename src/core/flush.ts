// Pre-reset memory flush (#45608): before a session's history is wiped by a reset,
// one LLM call distills the conversation into key facts/decisions and appends them
// to today's daily memory note. Failures return outcomes instead of throwing so a
// reset is never blocked by the flush.

import type { ChatMessage, ChatProvider } from "./agent.js";
import type { MemoryStore } from "./memory.js";

const DEFAULT_TRANSCRIPT_CHARS = 12_000;
/** A session with fewer user/assistant messages than this has nothing worth saving. */
const MIN_MEANINGFUL_MESSAGES = 2;

const FLUSH_SYSTEM_PROMPT =
  "You distill conversations into durable memory notes. " +
  'Reply with 3-8 short bullet lines starting with "- " that capture key facts, decisions, ' +
  "preferences, and open items worth remembering after the conversation is gone. " +
  "No preamble, no headings, no markdown beyond the bullets.";

export interface FlushSessionInput {
  provider: ChatProvider;
  memory: MemoryStore;
  sessionId: string;
  /** Full persisted history (oldest → newest) — snapshot taken before deletion. */
  history: ChatMessage[];
  /** Cap on the transcript handed to the summarizer (chars). */
  maxChars?: number;
}

export interface FlushOutcome {
  flushed: boolean;
  /** Daily-note path when flushed. */
  path?: string;
  /** Why nothing was saved (skips and failures both land here). */
  reason?: string;
}

/** user/assistant transcript, oldest → newest; tool chatter is dropped. */
export function transcriptForFlush(history: ChatMessage[], maxChars: number = DEFAULT_TRANSCRIPT_CHARS): string {
  const lines: string[] = [];
  for (const message of history) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    const content = message.content.trim();
    if (content === "") continue;
    lines.push(`${message.role === "user" ? "User" : "Assistant"}: ${content}`);
  }
  const text = lines.join("\n");
  if (text.length <= maxChars) return text;
  return `…(older turns elided)…\n${text.slice(text.length - maxChars)}`;
}

/**
 * One-shot agent-summarized flush: a single provider call over the transcript,
 * then an append to the daily note under a "## Reset — <sessionId>" header.
 */
export async function flushSessionToMemory(input: FlushSessionInput): Promise<FlushOutcome> {
  const meaningful = input.history.filter(
    (message) => (message.role === "user" || message.role === "assistant") && message.content.trim() !== "",
  ).length;
  if (meaningful < MIN_MEANINGFUL_MESSAGES) {
    return { flushed: false, reason: "too few messages to summarize" };
  }
  const transcript = transcriptForFlush(input.history, input.maxChars);
  let summary: string;
  try {
    const completion = await input.provider.complete({
      messages: [
        { role: "system", content: FLUSH_SYSTEM_PROMPT },
        {
          role: "user",
          content:
            `Session "${input.sessionId}" is about to be reset and its history deleted. ` +
            `Extract what must survive the reset:\n\n${transcript}`,
        },
      ],
      tools: [],
    });
    summary = completion.text.trim();
  } catch (error) {
    return { flushed: false, reason: `summarizer failed: ${(error as Error).message}` };
  }
  if (summary === "") return { flushed: false, reason: "summarizer returned nothing" };
  const path = input.memory.appendDaily(`\n## Reset — ${input.sessionId}\n${summary}\n`);
  return { flushed: true, path };
}
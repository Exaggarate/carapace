import { describe, expect, it } from "vitest";
import { STREAM_ERROR_FALLBACK_TEXT } from "../agents/stream-message-shared.js";
import { projectChatDisplayMessages } from "./chat-display-projection.js";
import { buildSessionHistorySnapshot, SessionHistorySseState } from "./session-history-state.js";

const user = { role: "user", content: "hello", __carapace: { seq: 1 } };
const failed = {
  role: "assistant",
  provider: "openai",
  model: "primary",
  content: [],
  stopReason: "error",
  errorMessage: "model unavailable",
  __carapace: { id: "failed", seq: 2, runId: "run-a" },
};
const answer = {
  role: "assistant",
  provider: "openai",
  model: "backup",
  content: [{ type: "text", text: "Recovered answer" }],
  stopReason: "stop",
  __carapace: { id: "answer", seq: 3, runId: "run-a" },
};

function projectedIds(messages: unknown[]) {
  return projectChatDisplayMessages(messages).map((message) => message["__carapace"]);
}

describe("recovered assistant errors", () => {
  it.each([
    { content: [] },
    { content: [{ type: "input_text", text: "" }] },
    { content: [{ type: "input_text", text: STREAM_ERROR_FALLBACK_TEXT }] },
    { content: [{ type: "text", text: STREAM_ERROR_FALLBACK_TEXT }] },
    { content: [{ type: "reasoning", text: "Internal reasoning" }] },
    { content: [{ type: "redacted_thinking", data: "redacted" }] },
    { content: "" },
    { content: [{ type: "text", text: "  " }] },
    { content: [{ type: "thinking", thinking: "private reasoning" }] },
  ])("retires repeated non-visible failed attempts after their run answers: %j", ({ content }) => {
    const failures = Array.from({ length: 4 }, (_, attempt) => ({
      ...failed,
      content,
      __carapace: { ...failed["__carapace"], id: `attempt-${attempt}`, seq: attempt + 2 },
    }));
    const final = { ...answer, __carapace: { ...answer["__carapace"], seq: 6 } };
    const raw = [user, ...failures, final];
    const original = structuredClone(raw);
    expect(projectedIds(raw)).toEqual([user["__carapace"], final["__carapace"]]);
    expect(buildSessionHistorySnapshot({ rawMessages: raw }).history.messages).toEqual([
      user,
      final,
    ]);
    expect(raw).toEqual(original);
  });

  it.each([
    { ...answer, __carapace: { ...answer["__carapace"], runId: "run-b" } },
    { ...answer, __carapace: { id: "answer", seq: 3 } },
    { ...answer, provider: "carapace", model: "gateway-injected" },
    { ...answer, stopReason: "toolUse" },
    { ...answer, stopReason: "error" },
    { ...answer, stopReason: "aborted" },
    { ...answer, display: false },
  ])("keeps the failure without a successful runtime answer from its own run: %j", (later) => {
    expect(projectedIds([user, failed, later])).toContainEqual(failed["__carapace"]);
  });

  it("keeps an unattributed failure and failures separated by a new user turn", () => {
    const unattributed = { ...failed, __carapace: { id: "failed", seq: 2 } };
    expect(projectedIds([user, unattributed, answer])).toContainEqual(unattributed["__carapace"]);
    expect(projectedIds([user, failed, { ...user, content: "next turn" }, answer])).toContainEqual(
      failed["__carapace"],
    );
    expect(projectedIds([user, failed])).toContainEqual(failed["__carapace"]);
  });

  it.each([
    { content: [{ type: "text", text: "A partial answer" }] },
    { content: [{ type: "toolCall", id: "call-1", name: "read", arguments: {} }] },
    { content: [{ type: "attachment", attachment: { kind: "document", label: "report.txt" } }] },
  ])("preserves failed attempts that already produced visible content: %j", ({ content }) => {
    expect(projectedIds([user, { ...failed, content }, answer])).toContainEqual(
      failed["__carapace"],
    );
  });

  it("preserves partial content even when a redundant text field is empty", () => {
    const partial = { ...failed, text: "", content: [{ type: "text", text: "Partial reply" }] };
    expect(projectChatDisplayMessages([user, partial, answer])[1]).toMatchObject({
      content: [{ type: "text", text: "Partial reply" }],
    });
  });

  it("repairs only matching attempts when run identities interleave", () => {
    const other = { ...failed, __carapace: { id: "other", seq: 3, runId: "run-b" } };
    expect(projectedIds([user, failed, other, answer])).toEqual([
      user["__carapace"],
      other["__carapace"],
      answer["__carapace"],
    ]);
  });

  it("retires the empty failure when its fallback answer reaches the output limit", () => {
    expect(projectedIds([user, failed, { ...answer, stopReason: "length" }])).toEqual([
      user["__carapace"],
      answer["__carapace"],
    ]);
  });

  it.each([false, true])(
    "refreshes earlier SSE history after recovery (initial error: %s)",
    (initial) => {
      const state = SessionHistorySseState.fromRawSnapshot({
        target: { sessionId: "session", sessionKey: "agent:main:test" },
        rawMessages: initial ? [user, failed] : [user],
      });
      if (!initial) {
        expect(
          state.appendInlineMessage({ message: failed, messageSeq: 2 })?.message,
        ).toMatchObject({
          stopReason: "error",
        });
      }
      expect(state.appendInlineMessage({ message: answer, messageSeq: 3 })).toEqual({
        shouldRefresh: true,
      });
    },
  );
});

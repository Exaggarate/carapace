import { describe, expect, it } from "vitest";
import { resolveIncognitoCarapaceAgentSqlitePath } from "../state/carapace-agent-db.js";
import { appendIncognitoSystemPrompt } from "./incognito-system-prompt.js";

describe("incognito system prompt", () => {
  it("appends the incognito instruction after existing per-session context", () => {
    expect(
      appendIncognitoSystemPrompt({
        agentId: "main",
        extraSystemPrompt: "Existing context.",
        storePath: resolveIncognitoCarapaceAgentSqlitePath({ agentId: "main" }),
      }),
    ).toBe(
      "Existing context.\n\nThis chat is incognito; do not store its conversation content in memory files or long-term notes.",
    );
  });
});

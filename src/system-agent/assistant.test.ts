// Carapace assistant tests cover plan parsing and inference prompt construction.
import { describe, expect, it } from "vitest";
import {
  SYSTEM_AGENT_ASSISTANT_SYSTEM_PROMPT,
  SYSTEM_AGENT_SYSTEM_PROMPT,
  buildSystemAgentAssistantUserPrompt,
  parseSystemAgentAssistantPlanText,
} from "./assistant-prompts.js";
import type { SystemAgentOverview } from "./overview.js";

function overview(overrides: Partial<SystemAgentOverview["tools"]> = {}): SystemAgentOverview {
  return {
    config: {
      path: "/tmp/carapace.json",
      exists: false,
      valid: false,
      issues: [],
      hash: null,
    },
    agents: [],
    defaultAgentId: "default",
    tools: {
      codex: { command: "codex", found: false },
      claude: { command: "claude", found: false },
      gemini: { command: "gemini", found: false },
      apiKeys: { openai: false, anthropic: false },
      ...overrides,
    },
    gateway: {
      url: "ws://127.0.0.1:14567",
      source: "local loopback",
      reachable: false,
    },
    references: {
      docsUrl: "https://github.com/Exaggarate/carapace",
      sourceUrl: "https://github.com/Exaggarate/carapace",
    },
  };
}

describe("Carapace assistant", () => {
  it("teaches both planner and agent-loop prompts about hosted setup flows", () => {
    expect(SYSTEM_AGENT_ASSISTANT_SYSTEM_PROMPT).toContain("- configure skills");
    expect(SYSTEM_AGENT_ASSISTANT_SYSTEM_PROMPT).toContain("- configure search");
    expect(SYSTEM_AGENT_ASSISTANT_SYSTEM_PROMPT).toContain("- open search wizard");
    expect(SYSTEM_AGENT_ASSISTANT_SYSTEM_PROMPT).toContain("- configure gateway");
    expect(SYSTEM_AGENT_ASSISTANT_SYSTEM_PROMPT).toContain("- open gateway wizard");
    expect(SYSTEM_AGENT_ASSISTANT_SYSTEM_PROMPT).toContain("- memory import");
    expect(SYSTEM_AGENT_ASSISTANT_SYSTEM_PROMPT).toContain("copy-only hosted flow");
    expect(SYSTEM_AGENT_SYSTEM_PROMPT).toContain("call configure_skills");
    expect(SYSTEM_AGENT_SYSTEM_PROMPT).toContain("call configure_search");
    expect(SYSTEM_AGENT_SYSTEM_PROMPT).toContain("call configure_gateway");
    expect(SYSTEM_AGENT_SYSTEM_PROMPT).toContain("call import_memory");
    expect(SYSTEM_AGENT_SYSTEM_PROMPT).toContain("default agent's existing workspace");
    expect(SYSTEM_AGENT_SYSTEM_PROMPT).toContain("Never ask for or repeat reusable secrets");
  });

  it("does not tell the fallback planner to solicit secrets", () => {
    expect(SYSTEM_AGENT_ASSISTANT_SYSTEM_PROMPT).not.toMatch(/\bask for secrets?\b/iu);
  });

  it.each([
    ["fallback planner", SYSTEM_AGENT_ASSISTANT_SYSTEM_PROMPT],
    ["primary agent loop", SYSTEM_AGENT_SYSTEM_PROMPT],
  ])("protects reusable secrets while allowing authorized sign-in in %s", (_name, prompt) => {
    expect(prompt).toContain("their request already authorizes the handoff");
    expect(prompt).toContain(
      "first select a private conversation with the requesting user from trusted conversation context",
    );
    expect(prompt).toContain("recovery/backup codes, and hidden device tokens");
    expect(prompt).toContain(
      "Keep these secrets out of chat, tool arguments, URLs, logs, and shell text",
    );
    expect(prompt).toContain("host-owned masked credential entry");
    expect(prompt).toContain(
      "trusted flow's short-lived user-facing code and verification URL only there",
    );
    expect(prompt).toContain("user-provided short-lived one-time codes or OAuth callbacks");
    expect(prompt).toContain("same pending flow");
    expect(prompt).toContain(
      "Keep messages intact unless the user requests deletion. Confirm completion from the login result.",
    );
  });

  it("keeps remote Gateway mode outside both hosted chat planners", () => {
    for (const prompt of [SYSTEM_AGENT_ASSISTANT_SYSTEM_PROMPT, SYSTEM_AGENT_SYSTEM_PROMPT]) {
      expect(prompt).toContain("running the Gateway on another machine");
      expect(prompt).toContain("`carapace onboard` for fresh setup");
      expect(prompt).toContain("`carapace configure` for the mode question");
      expect(prompt).toContain("LOCAL Gateway's port, bind, auth, and Tailscale exposure");
    }
  });

  it("parses the first compact JSON command", () => {
    expect(
      parseSystemAgentAssistantPlanText(
        'thinking... {"reply":"Aye aye.","command":"restart gateway"}',
      ),
    ).toEqual({
      reply: "Aye aye.",
      command: "restart gateway",
    });
  });

  it("rejects non-JSON and empty plans but accepts chat-only replies", () => {
    expect(parseSystemAgentAssistantPlanText("I would edit config directly.")).toBeNull();
    expect(parseSystemAgentAssistantPlanText("{}")).toBeNull();
    expect(parseSystemAgentAssistantPlanText('{"reply":"just chatting"}')).toEqual({
      reply: "just chatting",
    });
  });

  it("includes only operational summary context in planner prompts", () => {
    const prompt = buildSystemAgentAssistantUserPrompt({
      input: "fix my setup",
      overview: {
        ...overview({
          codex: { command: "codex", found: true, version: "codex 1.0.0" },
          apiKeys: { openai: true, anthropic: false },
        }),
        config: {
          path: "/tmp/carapace.json",
          exists: true,
          valid: true,
          issues: [],
          hash: "hash",
        },
        agents: [
          {
            id: "main",
            name: "Main",
            isDefault: true,
            model: "openai/gpt-5.5",
            workspace: "/tmp/main",
          },
        ],
        defaultAgentId: "main",
        defaultModel: "openai/gpt-5.5",
        references: {
          docsPath: "/tmp/carapace/docs",
          docsUrl: "https://github.com/Exaggarate/carapace",
          sourcePath: "/tmp/carapace",
          sourceUrl: "https://github.com/Exaggarate/carapace",
        },
      },
    });

    expect(prompt).toContain("User request: fix my setup");
    expect(prompt).toContain("Default model: openai/gpt-5.5");
    expect(prompt).toContain("id=main, name=Main, workspace=/tmp/main");
    expect(prompt).toContain("OpenAI API key: found");
    expect(prompt).toContain("Carapace docs: /tmp/carapace/docs");
    expect(prompt).toContain("Carapace source: /tmp/carapace");
  });

  it("keeps truncated conversation history valid at a UTF-16 boundary", () => {
    const prefix = "a".repeat(499);
    const prompt = buildSystemAgentAssistantUserPrompt({
      input: "continue",
      overview: overview(),
      history: [{ role: "user", text: `${prefix}🎉tail` }],
    });

    expect(prompt.slice(0, prompt.indexOf("User request:"))).toBe(
      `Conversation so far:\nUser: ${prefix}…\n\n`,
    );
  });
});

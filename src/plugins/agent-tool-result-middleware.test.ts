// Covers plugin middleware that can transform agent tool results.
import { describe, expect, it } from "vitest";
import {
  agentToolResultMiddlewareRegistrationCoversTool,
  appendAgentToolResultMiddlewareScope,
  normalizeAgentToolResultMiddlewareRuntimeIds,
  normalizeAgentToolResultMiddlewareRuntimes,
} from "./agent-tool-result-middleware.js";
import type { PluginAgentToolResultMiddlewareRegistration } from "./registry-types.js";

describe("normalizeAgentToolResultMiddlewareRuntimes", () => {
  it("defaults omitted runtimes to every supported runtime", () => {
    expect(normalizeAgentToolResultMiddlewareRuntimes()).toEqual(["carapace", "codex"]);
  });

  it("preserves an explicit empty runtime list", () => {
    expect(normalizeAgentToolResultMiddlewareRuntimes({ runtimes: [] })).toEqual([]);
  });

  it("ignores unknown runtime ids from manifest metadata", () => {
    expect(normalizeAgentToolResultMiddlewareRuntimeIds(["codex-app-server", "carapace"])).toEqual([
      "carapace",
    ]);
  });
});

describe("agent tool result middleware scopes", () => {
  it("keeps runtime and matcher registrations paired without cross-products", () => {
    const handler = () => undefined;
    const registration: PluginAgentToolResultMiddlewareRegistration = {
      pluginId: "policy",
      rawHandler: handler,
      handler,
      runtimes: ["codex"],
      scopes: [{ runtimes: ["codex"], matcher: ["exec"] }],
      source: "test",
    };
    appendAgentToolResultMiddlewareScope(registration, {
      runtimes: ["carapace"],
      matcher: ["apply_patch"],
    });

    expect(agentToolResultMiddlewareRegistrationCoversTool(registration, "codex", "exec")).toBe(
      true,
    );
    expect(agentToolResultMiddlewareRegistrationCoversTool(registration, "codex", "Bash")).toBe(
      false,
    );
    expect(
      agentToolResultMiddlewareRegistrationCoversTool(registration, "codex", "apply_patch"),
    ).toBe(false);
    expect(
      agentToolResultMiddlewareRegistrationCoversTool(registration, "carapace", "apply_patch"),
    ).toBe(true);
    expect(agentToolResultMiddlewareRegistrationCoversTool(registration, "carapace", "Write")).toBe(
      false,
    );
    expect(agentToolResultMiddlewareRegistrationCoversTool(registration, "carapace", "exec")).toBe(
      false,
    );
  });
});

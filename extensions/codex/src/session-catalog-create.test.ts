import {
  resolveAllowedModelRef,
  resolveDefaultModelForAgent,
} from "carapace/plugin-sdk/agent-runtime";
import type { CarapaceConfig } from "carapace/plugin-sdk/config-contracts";
import { describe, expect, it } from "vitest";
import { resolveCodexCatalogCreateSession } from "./session-catalog-create.js";

const modelConfig = { resolveAllowedModelRef, resolveDefaultModelForAgent };

function configWithAllowedModels(models: string[], runtime?: string): CarapaceConfig {
  return {
    agents: {
      defaults: {
        model: { primary: models[0] },
        models: Object.fromEntries(
          models.map((model) => [model, runtime ? { agentRuntime: { id: runtime } } : {}]),
        ),
      },
    },
  };
}

describe("resolveCodexCatalogCreateSession", () => {
  it("advertises the canonical implicit Codex default", () => {
    expect(resolveCodexCatalogCreateSession(modelConfig, {}, "main")).toEqual({
      model: "openai/gpt-5.6-sol",
      agentRuntime: "codex",
    });
  });

  it("pins the Codex model even when ordinary chats use the direct runtime", () => {
    expect(
      resolveCodexCatalogCreateSession(
        modelConfig,
        configWithAllowedModels(["openai/gpt-5.6-sol"], "carapace"),
        "main",
      ),
    ).toEqual({
      model: "openai/gpt-5.6-sol",
      agentRuntime: "codex",
    });
  });

  it("does not advertise creation when the Codex model is outside the allowlist", () => {
    expect(
      resolveCodexCatalogCreateSession(
        modelConfig,
        configWithAllowedModels(["openai/gpt-5.6-terra"]),
        "main",
      ),
    ).toBeUndefined();
  });

  it("uses the requested agent's model allowlist", () => {
    const config = {
      agents: {
        defaults: {
          model: { primary: "openai/gpt-5.6-sol" },
          models: { "openai/gpt-5.6-sol": {} },
        },
        list: [
          { id: "main", default: true },
          {
            id: "research",
            model: { primary: "openai/gpt-5.6-terra" },
            models: { "openai/gpt-5.6-terra": {} },
            modelPolicy: { allow: ["openai/gpt-5.6-terra"] },
          },
        ],
      },
    } satisfies CarapaceConfig;

    expect(resolveCodexCatalogCreateSession(modelConfig, config, "main")).toEqual({
      model: "openai/gpt-5.6-sol",
      agentRuntime: "codex",
    });
    expect(resolveCodexCatalogCreateSession(modelConfig, config, "research")).toBeUndefined();
  });

  it("does not advertise creation before runtime config is available", () => {
    expect(resolveCodexCatalogCreateSession(modelConfig, undefined, "main")).toBeUndefined();
  });
});

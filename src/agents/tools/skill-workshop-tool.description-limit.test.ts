import { validateToolArguments } from "carapace/plugin-sdk/llm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CarapaceConfig } from "../../config/types.carapace.js";
import {
  createCarapaceTestState,
  type CarapaceTestState,
} from "../../test-utils/carapace-test-state.js";
import { createTrackedTempDirs } from "../../test-utils/tracked-temp-dirs.js";
import { createSkillWorkshopTool } from "./skill-workshop-tool.js";

const tempDirs = createTrackedTempDirs();
let testState: CarapaceTestState;

beforeEach(async () => {
  testState = await createCarapaceTestState({
    layout: "state-only",
    prefix: "carapace-skill-workshop-description-state-",
  });
});

afterEach(async () => {
  await testState.cleanup();
  await tempDirs.cleanup();
});

describe("skill_workshop description validation", () => {
  it("lets the proposal service explain overlong descriptions", async () => {
    const workspaceDir = await tempDirs.make("carapace-skill-workshop-description-limit-");
    const tool = createSkillWorkshopTool({
      config: {} satisfies CarapaceConfig,
      workspaceDir,
      agentId: "main",
      env: testState.env,
    });
    const args = {
      action: "create" as const,
      name: "Long Description",
      description: "x".repeat(161),
      proposal_content: "# Long Description\n",
    };
    const call = {
      type: "toolCall" as const,
      id: "call-long-description",
      name: "skill_workshop",
      arguments: args,
    };
    expect(validateToolArguments(tool, call)).toEqual(args);

    await expect(tool.execute(call.id, args)).rejects.toThrow(
      "Skill proposal description is too large (161 bytes, max 160).",
    );
  });
});

import { loadConfig } from "../config/config.js";
import type { CarapaceConfig } from "../config/types.carapace.js";
import type { CarapaceTestState } from "../test-utils/carapace-test-state.js";
import { applyClawAddPlan } from "./add.js";
import { buildClawRemovalFixture } from "./lifecycle-remove.test-support.js";

export function createClawRemoveTestFixtures(
  tempDirs: { make: (prefix: string) => string },
  getState: () => CarapaceTestState,
) {
  async function fixture(params: Parameters<typeof buildClawRemovalFixture>[1] = {}) {
    const current = await buildClawRemovalFixture(tempDirs.make("carapace-claw-remove-"), params);
    return { ...current, env: { CARAPACE_STATE_DIR: getState().stateDir } };
  }

  async function addFixture(params: Parameters<typeof fixture>[0] = {}) {
    const current = await fixture(params);
    let config: CarapaceConfig = {};
    await applyClawAddPlan(current.plan, {
      consentPlanIntegrity: current.plan.planIntegrity,
      env: current.env,
      commitConfig: async (transform) => {
        config = transform(config);
        await getState().writeConfig(config);
      },
      cronGateway: { add: async () => ({ id: "scheduler-daily" }) },
      ...(params.withMcp ? { installMcpServers: async () => [] } : {}),
    });
    return { ...current, getConfig: loadConfig };
  }

  return { fixture, addFixture };
}

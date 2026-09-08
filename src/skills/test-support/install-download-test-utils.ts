// Install download test utilities provide isolated state and workspace paths.
import {
  createCarapaceTestState,
  type CarapaceTestState,
} from "../../test-utils/carapace-test-state.js";

/** Creates isolated Carapace state for install download tests. */
export async function createInstallDownloadTestState(): Promise<CarapaceTestState> {
  return await createCarapaceTestState({
    layout: "state-only",
    prefix: "carapace-skills-install-",
  });
}

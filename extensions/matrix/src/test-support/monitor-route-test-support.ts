// Matrix plugin module implements monitor route test support behavior.
export {
  registerSessionBindingAdapter,
  testing,
} from "carapace/plugin-sdk/session-binding-runtime";
export { resolveAgentRoute } from "carapace/plugin-sdk/routing";
export {
  createTestRegistry,
  setActivePluginRegistry,
} from "carapace/plugin-sdk/plugin-test-runtime";
export type { CarapaceConfig } from "carapace/plugin-sdk/config-contracts";

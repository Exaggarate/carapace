// QA Lab resolves Slack operations from the owning plugin's isolated dependency scope.
import { loadQaRunnerBundledPluginTestApi } from "carapace/plugin-sdk/qa-runner-runtime";

type SlackQaRuntime = typeof import("@carapace/slack/test-api.js");

let cachedSlackQaRuntime: SlackQaRuntime | undefined;

export function loadSlackQaRuntime(): SlackQaRuntime {
  cachedSlackQaRuntime ??= loadQaRunnerBundledPluginTestApi<SlackQaRuntime>("slack");
  return cachedSlackQaRuntime;
}

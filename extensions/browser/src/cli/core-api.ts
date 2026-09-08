/**
 * Shared CLI helpers only; Browser runtime imports belong to the lazy command leaves.
 */
export {
  formatCliCommand,
  formatHelpExamples,
  inheritOptionFromParent,
  runCommandWithRuntime,
  theme,
} from "carapace/plugin-sdk/cli-runtime";
export {
  addGatewayClientOptions,
  callGatewayFromCli,
  type GatewayRpcOpts,
} from "carapace/plugin-sdk/gateway-runtime";
export { getRuntimeConfig } from "carapace/plugin-sdk/runtime-config-snapshot";
export { danger, defaultRuntime, info } from "carapace/plugin-sdk/runtime-env";
export { formatDocsLink } from "carapace/plugin-sdk/setup-tools";
export { parseBooleanValue } from "carapace/plugin-sdk/string-coerce-runtime";
export { shortenHomePath } from "carapace/plugin-sdk/text-utility-runtime";

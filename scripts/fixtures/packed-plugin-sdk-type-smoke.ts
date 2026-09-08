// Packed Plugin Sdk Type Smoke script supports Carapace repository automation.
import { defineToolPlugin } from "carapace/plugin-sdk/tool-plugin";
type PublicPluginSdkModules = [
  typeof import("carapace/plugin-sdk/core"),
  typeof import("carapace/plugin-sdk/channel-entry-contract"),
  typeof import("carapace/plugin-sdk/config-contracts"),
  typeof import("carapace/plugin-sdk/plugin-entry"),
  typeof import("carapace/plugin-sdk/runtime-env"),
  typeof import("carapace/plugin-sdk/tool-plugin"),
];

const resolvedModules = null as unknown as PublicPluginSdkModules;
void resolvedModules;
void defineToolPlugin;

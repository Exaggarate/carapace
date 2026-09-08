// Irc plugin entrypoint registers its Carapace integration.
import { defineBundledChannelEntry } from "carapace/plugin-sdk/channel-entry-contract";

export default defineBundledChannelEntry({
  id: "irc",
  name: "IRC",
  description: "IRC channel plugin",
  importMetaUrl: import.meta.url,
  plugin: {
    specifier: "./channel-plugin-api.js",
    exportName: "ircPlugin",
  },
  secrets: {
    specifier: "./secret-contract-api.js",
    exportName: "channelSecrets",
  },
  runtime: {
    specifier: "./runtime-api.js",
    exportName: "setIrcRuntime",
  },
});

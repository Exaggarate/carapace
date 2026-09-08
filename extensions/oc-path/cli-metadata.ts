// OC Path module implements cli metadata behavior.
import { definePluginEntry } from "carapace/plugin-sdk/plugin-entry";
import { registerOcPathCli } from "./cli-registration.js";

export default definePluginEntry({
  id: "oc-path",
  name: "OC Path",
  description: "Adds the carapace path CLI for oc:// workspace file addressing.",
  register(api) {
    registerOcPathCli(api);
  },
});

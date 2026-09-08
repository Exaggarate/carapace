// Venice tests cover provider runtime.contract plugin behavior.
import { describeVeniceProviderRuntimeContract } from "carapace/plugin-sdk/provider-test-contracts";
import manifest from "./carapace.plugin.json" with { type: "json" };

describeVeniceProviderRuntimeContract(
  () => import("./index.js"),
  manifest.modelCatalog.providers.venice,
);

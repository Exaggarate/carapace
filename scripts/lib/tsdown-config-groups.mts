// Shared config names let the build wrapper isolate the large unified DTS graph.
export const TSDOWN_PACKAGE_CONFIG_GROUP = "carapace-packages";
export const TSDOWN_UNIFIED_CONFIG_GROUP = "carapace-unified";
export const TSDOWN_UNIFIED_DTS_CONFIG_GROUPS = [
  "carapace-dts-base",
  "carapace-dts-plugin-sdk-1",
  "carapace-dts-plugin-sdk-2",
  "carapace-dts-extensions-1",
  "carapace-dts-extensions-2",
  "carapace-dts-extensions-3",
  "carapace-dts-extensions-4",
  "carapace-dts-extensions-5",
] as const;

export const TSDOWN_PLUGIN_SDK_DTS_CONFIG_GROUPS = TSDOWN_UNIFIED_DTS_CONFIG_GROUPS.slice(1, 3);

export const TSDOWN_NON_SDK_DTS_CONFIG_GROUPS = TSDOWN_UNIFIED_DTS_CONFIG_GROUPS.filter(
  (group) => !TSDOWN_PLUGIN_SDK_DTS_CONFIG_GROUPS.includes(group),
);

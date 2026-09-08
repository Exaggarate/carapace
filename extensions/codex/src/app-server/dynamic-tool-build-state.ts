type CarapaceCodingToolsFactory =
  (typeof import("carapace/plugin-sdk/agent-harness"))["createCarapaceCodingTools"];

/** Mutable dependency seam shared by dynamic-tool construction and its behavioral tests. */
export const dynamicToolBuildState: {
  carapaceCodingToolsFactory?: CarapaceCodingToolsFactory;
} = {};

// Memory Core plugin module implements public artifacts behavior.
import {
  listMemoryHostPublicArtifacts,
  type MemoryPluginPublicArtifact,
} from "carapace/plugin-sdk/memory-host-core";
import type { CarapaceConfig } from "../api.js";

export async function listMemoryCorePublicArtifacts(params: {
  cfg: CarapaceConfig;
}): Promise<MemoryPluginPublicArtifact[]> {
  return await listMemoryHostPublicArtifacts(params);
}

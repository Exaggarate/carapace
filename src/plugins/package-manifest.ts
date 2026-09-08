import { isRecord } from "@carapace/normalization-core/record-coerce";
import { normalizeOptionalString } from "../../packages/normalization-core/src/string-coerce.js";
import { MANIFEST_KEY } from "../compat/legacy-names.js";
import type {
  CarapacePackageManifest,
  PackageExtensionResolution,
  PackageManifest,
} from "./package-manifest.types.js";

export type * from "./package-manifest.types.js";

export const DEFAULT_PLUGIN_ENTRY_CANDIDATES = [
  "index.ts",
  "index.js",
  "index.mjs",
  "index.cjs",
] as const;

export function getPackageManifestMetadata(
  manifest: PackageManifest | undefined,
): CarapacePackageManifest | undefined {
  if (!manifest) {
    return undefined;
  }
  return manifest[MANIFEST_KEY];
}

/** Package authoring metadata names source; the runtime manifest names only built assets. */
export function controlUiSource(packageManifest: Record<string, unknown>): string | undefined {
  const source = isRecord(packageManifest.carapace)
    ? packageManifest.carapace.controlUi
    : undefined;
  if (source === undefined) {
    return undefined;
  }
  if (typeof source !== "string" || !source.trim()) {
    throw new Error("package.json carapace.controlUi must name a browser source entrypoint.");
  }
  return source;
}

export function resolvePackageExtensionEntries(
  manifest: PackageManifest | undefined,
): PackageExtensionResolution {
  const rawCarapace = manifest?.[MANIFEST_KEY] as unknown;
  if (rawCarapace === undefined || rawCarapace === null) {
    return { status: "missing", entries: [] };
  }
  if (!isRecord(rawCarapace)) {
    return {
      status: "invalid",
      entries: [],
      error: "package.json carapace must be an object",
    };
  }
  const raw = rawCarapace.extensions;
  if (raw === undefined || raw === null) {
    return { status: "missing", entries: [] };
  }
  if (!Array.isArray(raw)) {
    return {
      status: "invalid",
      entries: [],
      error: "package.json carapace.extensions must be an array",
    };
  }
  const entries: string[] = [];
  for (const [index, entry] of raw.entries()) {
    const normalized = normalizeOptionalString(entry);
    if (!normalized) {
      return {
        status: "invalid",
        entries: [],
        error: `package.json carapace.extensions[${index}] must be a non-empty string`,
      };
    }
    entries.push(normalized);
  }
  if (entries.length === 0) {
    return { status: "empty", entries: [] };
  }
  return { status: "ok", entries };
}

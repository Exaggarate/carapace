// Keep in sync with "version" in package.json (single-sourced properly in M1).
export const VERSION = "0.11.0";

/**
 * True when the changelog text carries a "## v<version>" heading for the given
 * version (#48920). Anchored so "0.1" never false-matches "0.11.0".
 */
export function changelogCovers(changelogText: string, version: string): boolean {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^#{2,3}\\s+v${escaped}(?:[ .(]|$)`, "m").test(changelogText);
}
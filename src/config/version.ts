// Normalizes config version metadata and compatibility comparisons.
import { parse as parseSemver, type SemVer } from "semver";
import {
  compareCarapaceSemver,
  isCarapaceCorrectionSemver,
  normalizeLegacyDotBetaVersion,
} from "../infra/semver.js";

/** Parses stable, prerelease, and legacy dot-beta Carapace versions. */
function parseCarapaceVersion(raw: string | null | undefined): SemVer | null {
  if (!raw) {
    return null;
  }
  const normalized = normalizeLegacyDotBetaVersion(raw.trim());
  return parseSemver(normalized);
}

export function normalizeCarapaceVersionBase(raw: string | null | undefined): string | null {
  const parsed = parseCarapaceVersion(raw);
  if (!parsed) {
    return null;
  }
  return `${parsed.major}.${parsed.minor}.${parsed.patch}`;
}

export function compareCarapaceVersions(
  a: string | null | undefined,
  b: string | null | undefined,
): number | null {
  const parsedA = parseCarapaceVersion(a);
  const parsedB = parseCarapaceVersion(b);
  if (!parsedA || !parsedB) {
    return null;
  }
  return compareCarapaceSemver(parsedA, parsedB);
}

export function shouldWarnOnTouchedVersion(
  current: string | null | undefined,
  touched: string | null | undefined,
): boolean {
  const parsedCurrent = parseCarapaceVersion(current);
  const parsedTouched = parseCarapaceVersion(touched);
  if (parsedCurrent && parsedTouched && parsedCurrent.compareMain(parsedTouched) === 0) {
    if (parsedTouched.prerelease.length === 0 || isCarapaceCorrectionSemver(parsedTouched)) {
      return false;
    }
  }
  return parsedCurrent !== null && parsedTouched !== null
    ? compareCarapaceSemver(parsedCurrent, parsedTouched) < 0
    : false;
}

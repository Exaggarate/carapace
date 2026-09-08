import { hasNonEmptyString } from "@carapace/normalization-core/string-coerce";

export function hasAnyNonEmptyString(value: unknown): boolean {
  return Array.isArray(value) && value.some(hasNonEmptyString);
}

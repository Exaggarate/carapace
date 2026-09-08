/** Runtime type contracts for command-detection helpers loaded across lazy boundaries. */
import type { CarapaceConfig } from "../config/types.js";
import type { CommandNormalizeOptions } from "./commands-registry.types.js";

/** Runtime-injected predicate for deciding whether visible text is an Carapace command. */
export type IsControlCommandMessage = (
  text?: string,
  cfg?: CarapaceConfig,
  options?: CommandNormalizeOptions,
) => boolean;

/** Runtime-injected predicate for deciding whether command authorization must be computed. */
export type ShouldComputeCommandAuthorized = (
  text?: string,
  cfg?: CarapaceConfig,
  options?: CommandNormalizeOptions,
) => boolean;

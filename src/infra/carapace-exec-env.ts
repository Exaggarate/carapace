/** Process env key that marks child commands as launched by the Carapace CLI. */
export const CARAPACE_CLI_ENV_VAR = "CARAPACE_CLI";

/** Stable marker value used for Carapace-launched subprocess detection. */
const CARAPACE_CLI_ENV_VALUE = "1";

/** Returns a cloned env object with the Carapace CLI marker set. */
export function markCarapaceExecEnv<T extends Record<string, string | undefined>>(
  /** Source environment to clone before adding the subprocess marker. */
  env: T,
): T {
  return {
    ...env,
    [CARAPACE_CLI_ENV_VAR]: CARAPACE_CLI_ENV_VALUE,
  };
}

/** Mutates an existing process env object so current-process children inherit the marker. */
export function ensureCarapaceExecMarkerOnProcess(
  /** Process env object to mutate; defaults to the current process environment. */
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  env[CARAPACE_CLI_ENV_VAR] = CARAPACE_CLI_ENV_VALUE;
  return env;
}

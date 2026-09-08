/** Internal host-only metadata used to make Code Mode collector spawns replay-safe. */
export const SWARM_CODE_MODE_IDEMPOTENCY_KEY = Symbol.for("carapace.swarmCodeModeIdempotencyKey");

export const SWARM_CODE_MODE_REQUEST_FINGERPRINT = Symbol.for(
  "carapace.swarmCodeModeRequestFingerprint",
);

// Home environment test support isolates HOME-style paths for skill tests.
import os from "node:os";
import { vi } from "vitest";
import { deleteTestEnvValue, setTestEnvValue } from "../../test-utils/env.js";

/** Process home env snapshot used by skill loader tests. */
export type SkillsHomeEnvSnapshot = {
  previousHome: string | undefined;
  previousCarapaceHome: string | undefined;
  previousCarapaceStateDir: string | undefined;
  previousUserProfile: string | undefined;
};

export function setMockSkillsHomeEnv(fakeHome: string): SkillsHomeEnvSnapshot {
  const snapshot: SkillsHomeEnvSnapshot = {
    previousHome: process.env.HOME,
    previousCarapaceHome: process.env.CARAPACE_HOME,
    previousCarapaceStateDir: process.env.CARAPACE_STATE_DIR,
    previousUserProfile: process.env.USERPROFILE,
  };
  setTestEnvValue("HOME", fakeHome);
  deleteTestEnvValue("CARAPACE_HOME");
  deleteTestEnvValue("CARAPACE_STATE_DIR");
  deleteTestEnvValue("USERPROFILE");
  vi.spyOn(os, "homedir").mockReturnValue(fakeHome);
  return snapshot;
}

function restoreEnvValue(key: string, value: string | undefined): void {
  if (value === undefined) {
    deleteTestEnvValue(key);
  } else {
    setTestEnvValue(key, value);
  }
}

export async function restoreMockSkillsHomeEnv(
  snapshot: SkillsHomeEnvSnapshot,
  cleanup?: () => Promise<void> | void,
) {
  vi.restoreAllMocks();
  restoreEnvValue("HOME", snapshot.previousHome);
  restoreEnvValue("CARAPACE_HOME", snapshot.previousCarapaceHome);
  restoreEnvValue("CARAPACE_STATE_DIR", snapshot.previousCarapaceStateDir);
  restoreEnvValue("USERPROFILE", snapshot.previousUserProfile);
  await cleanup?.();
}

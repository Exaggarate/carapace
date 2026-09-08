import { describe, expect, it } from "vitest";
import {
  checkNativeStateSchemaVersion,
  compareNativeStateSchemaVersions,
} from "../../scripts/check-native-state-schema-version.mjs";
import { CARAPACE_STATE_SCHEMA_VERSION } from "../../src/state/carapace-state-db-contract.js";

describe("native state schema version guard", () => {
  it("keeps the checked-in Swift and TypeScript contracts aligned", () => {
    expect(checkNativeStateSchemaVersion()).toBe(CARAPACE_STATE_SCHEMA_VERSION);
  });

  it("fails when a deliberate Swift fixture drifts behind TypeScript", () => {
    expect(() =>
      compareNativeStateSchemaVersions({
        swiftSource: "private static let maximumSupportedSchemaVersion: Int64 = 5\n",
        typescriptSource: "export const CARAPACE_STATE_SCHEMA_VERSION = 9;\n",
      }),
    ).toThrow("Native state schema version drift: Swift supports 5, TypeScript owns 9");
  });
});

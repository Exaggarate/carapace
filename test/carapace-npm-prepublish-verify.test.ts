import { describe, expect, it } from "vitest";
import {
  carapaceNpmPrepublishVerifyUsage,
  parseCarapaceNpmPrepublishVerifyArgs,
  usesPreparedLocalDependencyInstall,
} from "../scripts/carapace-npm-prepublish-verify.ts";

describe("parseCarapaceNpmPrepublishVerifyArgs", () => {
  it("supports help, optional versions, and package-manager separators", () => {
    expect(parseCarapaceNpmPrepublishVerifyArgs(["--help"])).toEqual({
      dependencyTarballPaths: [],
      help: true,
      tarballPath: "",
    });
    expect(parseCarapaceNpmPrepublishVerifyArgs(["carapace.tgz"])).toEqual({
      dependencyTarballPaths: [],
      help: false,
      tarballPath: "carapace.tgz",
    });
    expect(parseCarapaceNpmPrepublishVerifyArgs(["--", "carapace.tgz", "2026.3.23"])).toEqual({
      dependencyTarballPaths: [],
      expectedVersion: "2026.3.23",
      help: false,
      tarballPath: "carapace.tgz",
    });
  });

  it("rejects missing, option-like, and extra arguments before installing", () => {
    expect(() => parseCarapaceNpmPrepublishVerifyArgs([])).toThrow(
      carapaceNpmPrepublishVerifyUsage(),
    );
    expect(() => parseCarapaceNpmPrepublishVerifyArgs(["--tag"])).toThrow(
      "Unknown carapace npm prepublish verifier option: --tag",
    );
    expect(() => parseCarapaceNpmPrepublishVerifyArgs(["carapace.tgz", "--tag"])).toThrow(
      "Unknown carapace npm prepublish verifier option: --tag",
    );
    expect(
      parseCarapaceNpmPrepublishVerifyArgs(["carapace.tgz", "2026.3.23", "llm-core.tgz", "ai.tgz"]),
    ).toEqual({
      dependencyTarballPaths: ["llm-core.tgz", "ai.tgz"],
      expectedVersion: "2026.3.23",
      help: false,
      tarballPath: "carapace.tgz",
    });
    expect(() =>
      parseCarapaceNpmPrepublishVerifyArgs(["carapace.tgz", "2026.3.23", "--bad"]),
    ).toThrow("Invalid dependency tarball path: --bad");
  });
});

describe("usesPreparedLocalDependencyInstall", () => {
  it("uses the prepared local project only for the single AI tarball release path", () => {
    expect(usesPreparedLocalDependencyInstall(0)).toBe(false);
    expect(usesPreparedLocalDependencyInstall(1)).toBe(true);
    expect(usesPreparedLocalDependencyInstall(2)).toBe(false);
  });
});

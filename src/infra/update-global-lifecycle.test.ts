import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { globalInstallArgs, globalInstallFallbackArgs } from "./update-global.js";

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  execFileSync: vi.fn(() => "/tmp/carapace-test-global-npmrc\n"),
}));

describe("npm global install lifecycle policy", () => {
  it("applies an unflagged npm policy to primary and retry argv", () => {
    expect(
      globalInstallArgs("npm", "carapace@latest", null, null, null, "unflagged"),
    ).not.toContain("--allow-scripts=carapace");
    expect(
      globalInstallFallbackArgs("npm", "carapace@latest", null, null, null, "unflagged"),
    ).toEqual(expect.arrayContaining(["--omit=optional"]));
    expect(
      globalInstallFallbackArgs("npm", "carapace@latest", null, null, null, "unflagged"),
    ).not.toContain("--allow-scripts=carapace");
  });

  it("builds npm staged install argv with an explicit prefix", () => {
    expect(globalInstallArgs("npm", "carapace@latest", null, "/tmp/stage")).toEqual([
      "npm",
      "i",
      "-g",
      "--allow-scripts=carapace",
      "--prefix",
      "/tmp/stage",
      "carapace@latest",
      "--no-fund",
      "--no-audit",
      "--loglevel=error",
      "--min-release-age=0",
    ]);
    expect(globalInstallFallbackArgs("npm", "carapace@latest", null, "/tmp/stage")).toEqual([
      "npm",
      "i",
      "-g",
      "--allow-scripts=carapace",
      "--prefix",
      "/tmp/stage",
      "carapace@latest",
      "--omit=optional",
      "--no-fund",
      "--no-audit",
      "--loglevel=error",
      "--min-release-age=0",
    ]);
  });

  it("omits npm's lifecycle allowlist before npm 11.16", () => {
    expect(
      globalInstallArgs("npm", "carapace@latest", null, null, null, "unflagged"),
    ).not.toContain("--allow-scripts=carapace");
  });

  it("allows only the resolved npm candidate lifecycle identity", () => {
    const archive = path.resolve("/tmp/carapace-2026.7.2.tgz");
    expect(globalInstallArgs("npm", archive)).toContain(`--allow-scripts=${archive}`);
    expect(globalInstallArgs("npm", "carapace@npm:@vendor/carapace@1.2.3")).toContain(
      "--allow-scripts=@vendor/carapace",
    );
    expect(globalInstallArgs("npm", "carapace@npm:vendor-carapace@1.2.3")).toContain(
      "--allow-scripts=vendor-carapace",
    );
    expect(globalInstallArgs("npm", "carapace@npm:@vendor/client.tgz@1.2.3")).toContain(
      "--allow-scripts=@vendor/client.tgz",
    );
    expect(globalInstallArgs("npm", "./carapace-candidate")).toContain(
      "--allow-scripts=./carapace-candidate",
    );
    for (const spec of ["vendor/repo.tgz", "vendor/repo#release.tgz"]) {
      expect(globalInstallArgs("npm", spec)).toContain(`--allow-scripts=${spec}`);
    }
  });

  it("keeps commas in ancestor directories out of npm's lifecycle policy", () => {
    expect(
      globalInstallArgs(
        "npm",
        "/tmp/build,cache/carapace-candidate",
        null,
        null,
        "/tmp/build,cache",
      ),
    ).toContain("--allow-scripts=./carapace-candidate");
  });

  it.each(["absolute", "relative", "file:absolute", "file:relative"])(
    "uses the absolute npm tarball identity for %s input",
    (form) => {
      const cwd = path.resolve("/tmp/carapace-update-identity/work");
      const candidate = path.resolve(cwd, "../candidate.tgz");
      const protocol = form.startsWith("file:") ? "file:" : "";
      const spec = `${protocol}${form.endsWith("relative") ? "../candidate.tgz" : candidate}`;
      for (const buildArgs of [globalInstallArgs, globalInstallFallbackArgs]) {
        const args = buildArgs("npm", spec, null, null, cwd);
        expect(args).toContain(`--allow-scripts=${protocol}${candidate}`);
        expect(args).toContain(spec);
      }
    },
  );

  it("rejects comma tarball identities before building npm install commands", () => {
    const cwd = path.resolve("/tmp/build,cache");
    for (const buildArgs of [globalInstallArgs, globalInstallFallbackArgs]) {
      expect(() => buildArgs("npm", path.join(cwd, "candidate.tgz"), null, null, cwd)).toThrow(
        "without commas",
      );
    }
  });

  it.each([
    "file:/../candidate.tgz",
    "file:///../candidate.tgz",
    "file:~/candidate.tgz",
    "file:/~/candidate.tgz",
    "file:///~/candidate.tgz",
    "file:./~/candidate.tgz",
  ])("preserves npm's local archive resolution for %s", (spec) => {
    const cwd = path.resolve("/tmp/carapace-update-identity/work");
    const expected = spec.includes("~")
      ? path.join(os.homedir(), "candidate.tgz")
      : path.resolve(cwd, "../candidate.tgz");
    expect(globalInstallArgs("npm", spec, null, null, cwd)).toContain(
      `--allow-scripts=file:${expected}`,
    );
  });

  it.each(["tgz", "tar.gz", "tar"])(
    "normalizes file URLs while preserving literal archive characters for .%s",
    (extension) => {
      const archive = path.resolve(`/tmp/carapace/a%2C#b.${extension}`);
      const spec = `file:///${archive.replaceAll("\\", "/").replace(/^\/+/u, "")}`;
      expect(globalInstallArgs("npm", spec)).toContain(`--allow-scripts=file:${archive}`);
    },
  );

  it("preserves npm 11 advisory comma-archive identity without changing npm policy", () => {
    const cwd = path.resolve("/tmp/build,cache");
    for (const buildArgs of [globalInstallArgs, globalInstallFallbackArgs]) {
      expect(
        buildArgs(
          "npm",
          path.join(cwd, "candidate.tgz"),
          null,
          null,
          cwd,
          "allow-scripts-advisory",
        ),
      ).toContain("--allow-scripts=./candidate.tgz");
    }
  });
});

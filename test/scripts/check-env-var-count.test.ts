import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectEnvVarNames,
  isCountedSourcePath,
  main,
} from "../../scripts/check-env-var-count.mts";
import { withEnv } from "../../src/test-utils/env.js";
import { useAutoCleanupTempDirTracker } from "../helpers/temp-dir.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);

function createRepo(files: Record<string, string> = {}) {
  const root = tempDirs.make("carapace-env-count-");
  const git = (...args: string[]) =>
    execFileSync(
      "git",
      ["-c", "user.name=Carapace", "-c", "user.email=test@carapace.local", ...args],
      { cwd: root, stdio: "ignore" },
    );
  const write = (file: string, source: string) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), source);
  };
  git("init");
  for (const [file, source] of Object.entries(files)) {
    write(file, source);
  }
  return { root, git, write };
}

describe("check-env-var-count", () => {
  it("counts production source and excludes tests and QA Lab", () => {
    expect(isCountedSourcePath("src/config/paths.ts")).toBe(true);
    expect(isCountedSourcePath("packages/api/src/index.ts")).toBe(true);
    expect(isCountedSourcePath("extensions/demo/src/index.ts")).toBe(true);
    expect(isCountedSourcePath("src/config/paths.test.ts")).toBe(false);
    expect(isCountedSourcePath("extensions/qa-lab/src/index.ts")).toBe(false);
  });

  it("keeps an empty index separate from untracked worktree sources", () => {
    const { root, write } = createRepo();
    expect(collectEnvVarNames(root, { staged: true })).toEqual([]);
    write("src/runtime.ts", "CARAPACE_UNTRACKED");
    expect(collectEnvVarNames(root, { staged: true })).toEqual([]);
    expect(collectEnvVarNames(root)).toEqual(["CARAPACE_UNTRACKED"]);
  });

  it("collects distinct names from the whole selected snapshot without crossing file boundaries", () => {
    const { root, git, write } = createRepo({
      ".gitignore": "src/ignored.ts\n",
      "src/partial.ts": "CARAPACE_HEAD",
      "src/modified.ts": "CARAPACE_OLD",
      "src/removed.ts": "CARAPACE_REMOVED",
      "src/gone.ts": "CARAPACE_GONE",
      "src/empty.ts": "",
      "src/boundary-a.ts": "CARAPACE_",
      "src/boundary-b.ts": "BOUNDARY_TRAP",
      "src/unchanged.ts": "é 🦞 東京\nCARAPACE_SHARED\0CARAPACE_UNICODE",
      "packages/api/index.mts": "CARAPACE_SHARED CARAPACE_SHARED",
      "extensions/demo/index.cjs": "CARAPACE_PLUGIN",
      "src/runtime.test.ts": "CARAPACE_EXCLUDED",
      "src/__tests__/index.ts": "CARAPACE_EXCLUDED",
      "packages/api/test/index.ts": "CARAPACE_EXCLUDED",
      "extensions/demo/index.spec.ts": "CARAPACE_EXCLUDED",
      "extensions/qa-lab/index.ts": "CARAPACE_EXCLUDED",
      "extensions/test-support/index.ts": "CARAPACE_EXCLUDED",
      "src/runtime.json": "CARAPACE_EXCLUDED",
      "ui/src/runtime.ts": "CARAPACE_EXCLUDED",
    });
    git("add", ".");
    git("commit", "-m", "base");
    write("src/partial.ts", "CARAPACE_INDEX");
    write("src/modified.ts", "CARAPACE_MODIFIED");
    write("src/added.ts", "CARAPACE_ADDED");
    git("add", ".");
    write("src/partial.ts", "CARAPACE_WORKTREE");
    write("src/added.ts", "CARAPACE_UNSTAGED_ADDITION");
    git("rm", "--cached", "src/removed.ts");
    fs.rmSync(path.join(root, "src/gone.ts"));
    write("src/untracked.ts", "CARAPACE_UNTRACKED");
    write("src/ignored.ts", "CARAPACE_IGNORED");

    const shared = ["CARAPACE_MODIFIED", "CARAPACE_PLUGIN", "CARAPACE_SHARED", "CARAPACE_UNICODE"];
    expect(collectEnvVarNames(root, { staged: true })).toEqual(
      [...shared, "CARAPACE_ADDED", "CARAPACE_GONE", "CARAPACE_INDEX"].toSorted(),
    );
    expect(collectEnvVarNames(root)).toEqual(
      [
        ...shared,
        "CARAPACE_REMOVED",
        "CARAPACE_UNSTAGED_ADDITION",
        "CARAPACE_UNTRACKED",
        "CARAPACE_WORKTREE",
      ].toSorted(),
    );
  });

  it("uses a constant number of Git processes as the staged source set grows", () => {
    const counts = [8, 16].map((fileCount) => {
      const names = Array.from({ length: fileCount }, (_, index) => `CARAPACE_N${index}`);
      const { root, git } = createRepo(
        Object.fromEntries(names.map((name, index) => [`src/file-${index}.ts`, name])),
      );
      git("add", ".");
      const traceFile = path.join(root, "git-trace.jsonl");
      const collected = withEnv({ GIT_TRACE2_EVENT: traceFile }, () =>
        collectEnvVarNames(root, { staged: true }),
      );
      expect(collected).toEqual(names.toSorted());
      return fs
        .readFileSync(traceFile, "utf8")
        .trim()
        .split("\n")
        .filter((line) => JSON.parse(line).event === "start").length;
    });
    expect(Math.min(...counts)).toBeGreaterThan(0);
    expect(Math.max(...counts)).toBeLessThanOrEqual(2);
    expect(new Set(counts).size).toBe(1);
  });

  it.skipIf(process.platform === "win32")("preserves valid unusual staged filenames", () => {
    const { root, git } = createRepo({
      "src/space name.ts": "CARAPACE_SPACE",
      "packages/api/tab\tname.ts": "CARAPACE_TAB",
      "extensions/demo/newline\nname.ts": "CARAPACE_NEWLINE",
      "src/conflict blob 0\n\nx blob 0\n\nx blob 0\n\n.ts": "CARAPACE_HEADER",
    });
    git("add", ".");
    expect(collectEnvVarNames(root, { staged: true })).toEqual([
      "CARAPACE_HEADER",
      "CARAPACE_NEWLINE",
      "CARAPACE_SPACE",
      "CARAPACE_TAB",
    ]);
  });

  it.each([
    "src/conflict.ts",
    ...(process.platform === "win32" ? [] : ["src/conflict blob 0\n\nx blob 0\n\nx blob 0\n\n.ts"]),
  ])("rejects an unresolved stage-zero source: %s", (file) => {
    const { root } = createRepo({ [file]: "CARAPACE_WORKTREE" });
    const oid = execFileSync("git", ["hash-object", "-w", "--stdin"], {
      cwd: root,
      input: "CARAPACE_CONFLICT",
      encoding: "utf8",
    }).trim();
    execFileSync("git", ["update-index", "-z", "--index-info"], {
      cwd: root,
      input: [1, 2, 3].map((stage) => `100644 ${oid} ${stage}\t${file}\0`).join(""),
    });
    expect(() => collectEnvVarNames(root, { staged: true })).toThrow();
  });

  it("fails closed when the base ref cannot be resolved", () => {
    const { root } = createRepo({ "config/env-var-count-budget.txt": "0\n" });
    expect(() => main(["--base", "missing"], root)).toThrow(/Could not resolve/u);
  });

  it("still checks the budget when the base shares no reachable ancestor", () => {
    // Shallow clones and grafted agent checkouts resolve the base but truncate its history.
    const { root, git, write } = createRepo({
      "config/env-var-count-budget.txt": "1\n",
      "src/runtime.ts": "process.env.CARAPACE_ONLY;\n",
    });
    git("add", ".");
    git("commit", "-m", "detached base");
    // Name the base explicitly; init.defaultBranch varies by environment.
    git("branch", "-M", "severed-base");
    git("checkout", "--orphan", "severed");
    git("add", ".");
    git("commit", "-m", "severed history");
    expect(() => main(["--base", "severed-base"], root)).not.toThrow();

    write("src/runtime.ts", "process.env.CARAPACE_ONE; process.env.CARAPACE_TWO;\n");
    expect(() => main(["--base", "severed-base"], root)).toThrow(/exceeds budget/u);
  });

  it("compares against the fork budget when the base branch later shrinks", () => {
    const { root, git, write } = createRepo({
      "config/env-var-count-budget.txt": "2\n",
      "src/runtime.ts": "process.env.CARAPACE_ONE; process.env.CARAPACE_TWO;\n",
    });
    git("add", ".");
    git("commit", "-m", "base");
    git("branch", "release");
    write("config/env-var-count-budget.txt", "1\n");
    write("src/runtime.ts", "process.env.CARAPACE_ONE;\n");
    git("add", ".");
    git("commit", "-m", "shrink main");
    git("branch", "moving-main");
    git("checkout", "release");
    expect(() => main(["--base", "moving-main"], root)).not.toThrow();
  });

  describe.each([false, true])("budget enforcement with staged=%s", (staged) => {
    it.each([
      { name: "exact count", base: 2, budget: 2, count: 2, error: undefined },
      { name: "count growth", base: 2, budget: 2, count: 3, error: /exceeds budget/u },
      { name: "stale headroom", base: 2, budget: 2, count: 1, error: /is below budget/u },
      {
        name: "retired 501 to 502 increase",
        base: 501,
        budget: 502,
        count: 502,
        error: /budget grew/u,
      },
      {
        name: "retired 502 to 503 increase",
        base: 502,
        budget: 503,
        count: 503,
        error: /budget grew/u,
      },
    ])("checks $name", ({ base, budget, count, error }) => {
      const { root, git, write } = createRepo({
        "config/env-var-count-budget.txt": `${base}\n`,
        "src/runtime.ts": Array.from({ length: base }, (_, index) => `CARAPACE_BASE_${index}`).join(
          "\n",
        ),
      });
      git("add", ".");
      git("commit", "-m", "base");
      write("config/env-var-count-budget.txt", `${budget}\n`);
      write(
        "src/runtime.ts",
        Array.from({ length: count }, (_, index) => `CARAPACE_NEXT_${index}`).join("\n"),
      );
      if (staged) {
        git("add", ".");
        write("config/env-var-count-budget.txt", "0\n");
        write("src/runtime.ts", "");
      }
      const run = () => main([...(staged ? ["--staged"] : []), "--base", "HEAD"], root);
      if (error) {
        expect(run).toThrow(error);
      } else {
        expect(run()).toBe(count);
      }
    });
  });
});

import { describe, expect, it } from "vitest";
import {
  createDocumentedCompletionProgram,
  runGeneratedBashCompletion,
} from "./completion-cli.test-support.js";

describe("completion-cli native Bash words", () => {
  it.skipIf(process.platform !== "darwin")("uses macOS Bash byte offsets in a UTF-8 locale", () => {
    const prefix = "carapace gateway --token=é status --j";

    expect(
      runGeneratedBashCompletion(
        createDocumentedCompletionProgram(),
        ["carapace", "gateway", "--token=é", "status", "--json"],
        {
          line: `${prefix}son`,
          word: "--j",
          point: Buffer.byteLength(prefix),
          bashPath: "/bin/bash",
          env: { ...process.env, LC_ALL: "en_US.UTF-8" },
        },
      ),
    ).toEqual(["--json"]);
  });

  it.skipIf(process.platform === "win32").each([
    {
      line: "carapace completion --shell=",
      words: ["carapace", "completion", "--shell", "="],
      word: "",
      expected: ["zsh", "bash", "powershell", "fish"],
    },
    {
      line: "carapace --profile=gateway completion --shell f",
      words: ["carapace", "--profile", "=", "gateway", "completion", "--shell", "f"],
      word: "f",
      expected: ["fish"],
    },
    {
      line: "carapace completion --shell=f",
      words: ["carapace", "completion", "--shell=f"],
      word: "f",
      expected: ["fish"],
    },
    {
      line: "carapace completion --shell=fish",
      words: ["carapace", "completion", "--shell", "=", "fish"],
      word: "f",
      point: 29,
      expected: ["fish"],
    },
    {
      line: "carapace completion --shell=fish",
      words: ["carapace", "completion", "--shell=fish"],
      word: "f",
      point: 29,
      expected: ["fish"],
    },
    {
      line: "carapace completion --shell=fish",
      words: ["carapace", "completion", "--shell", "=", "fish"],
      word: "",
      point: 28,
      expected: ["zsh", "bash", "powershell", "fish"],
    },
    {
      line: "carapace completion --shell=bogus",
      words: ["carapace", "completion", "--shell", "=", "bogus"],
      word: "b",
      point: 29,
      expected: ["bash"],
    },
    {
      line: "carapace completion --sh=fish",
      words: ["carapace", "completion", "--sh=fish"],
      word: "--sh",
      point: 24,
      expected: ["--shell"],
    },
    {
      line: "carapace completion -ysfish",
      words: ["carapace", "completion", "-ysfish"],
      word: "-ysf",
      point: 24,
      expected: ["-ysfish"],
    },
    {
      line: "carapace --profile=gateway completion --shell=fish --yes",
      words: [
        "carapace",
        "--profile",
        "=",
        "gateway",
        "completion",
        "--shell",
        "=",
        "fish",
        "--yes",
      ],
      word: "f",
      point: 47,
      cword: 7,
      expected: ["fish"],
    },
    {
      line: "carapace completion --shell=fish",
      words: ["carapace", "completion", "--shell=fish"],
      word: "comple",
      point: 15,
      cword: 1,
      expected: ["completion"],
    },
    {
      line: "carapace gateway --token = status --j",
      words: ["carapace", "gateway", "--token", "=", "status", "--j"],
      word: "--j",
      expected: ["--json"],
    },
    {
      line: "carapace completion>/dev/null --shell f",
      words: ["carapace", "completion", ">", "/dev/null", "--shell", "f"],
      word: "f",
      expected: ["fish"],
    },
    {
      line: "carapace gateway --token=prefix:status --f",
      words: ["carapace", "gateway", "--token", "=", "prefix", ":", "status", "--f"],
      word: "--f",
      expected: ["--force"],
    },
    {
      line: "carapace gateway --token=foo==status --f",
      words: ["carapace", "gateway", "--token", "=", "foo", "==", "status", "--f"],
      word: "--f",
      expected: ["--force"],
    },
    ...['"f', "'f", '"f"', "\\f", 'f"i'].map((value) => ({
      line: `carapace completion --shell ${value}`,
      words: ["carapace", "completion", "--shell", value],
      word: value === 'f"i' ? "i" : value === '"f' || value === "'f" ? "f" : value,
      expected: [value === 'f"i' ? "ish" : "fish"],
    })),
    ...['"', "'"].flatMap((quote) => [
      {
        line: `carapace completion --shell=${quote}f`,
        words: ["carapace", "completion", `--shell=${quote}f`],
        word: "f",
        expected: ["fish"],
      },
      {
        line: `carapace completion --shell=${quote}f`,
        words: ["carapace", "completion", "--shell", "=", `${quote}f`],
        word: "f",
        expected: ["fish"],
      },
      {
        line: `carapace completion -s ${quote}f`,
        words: ["carapace", "completion", "-s", `${quote}f`],
        word: "f",
        expected: ["fish"],
      },
    ]),
  ])("respects native Bash word boundaries in $line at $point", ({ words, expected, ...input }) => {
    const program = createDocumentedCompletionProgram().option("--profile <name>", "Profile");

    expect(runGeneratedBashCompletion(program, words, input)).toEqual(expected);
  });
});

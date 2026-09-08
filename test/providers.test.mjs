// Multi-provider LLM layer (M7): OpenAI-shape and Anthropic-shape mock responses,
// tool_use block mapping, the provider factory, and the fallback chain.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

import { OpenAiProvider } from "../dist/core/llm/providers/openai.js";
import { AnthropicProvider } from "../dist/core/llm/providers/anthropic.js";
import { OllamaLocalProvider } from "../dist/core/llm/providers/ollama.js";
import { FallbackProvider } from "../dist/core/llm/providers/fallback.js";
import { createProviderFromConfig, describeProviderChain } from "../dist/gateway/runtime.js";
import { validateConfig } from "../dist/config.js";

const SPEC = {
  type: "function",
  function: {
    name: "exec",
    description: "run a command",
    parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
  },
};

function startMock(handler) {
  return new Promise((resolve, reject) => {
    const server = createServer(handler);
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => resolve(raw));
  });
}

test("OpenAiProvider parses chat/completions tool_calls and sends auth", async () => {
  let captured = null;
  const server = await startMock(async (req, res) => {
    captured = { headers: req.headers, body: JSON.parse(await readBody(req)) };
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              role: "assistant",
              content: "",
              tool_calls: [
                { id: "call_1", type: "function", function: { name: "exec", arguments: '{"command":"ls -la"}' } },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      }),
    );
  });
  try {
    const provider = new OpenAiProvider({
      baseURL: `http://127.0.0.1:${server.address().port}`,
      apiKey: "sk-test",
      model: "test-model",
      timeoutMs: 2_000,
    });
    const result = await provider.complete({ messages: [{ role: "user", content: "hi" }], tools: [SPEC] });
    assert.equal(result.stopReason, "tool_use");
    assert.equal(result.toolCalls[0].name, "exec");
    assert.deepEqual(result.toolCalls[0].arguments, { command: "ls -la" });
    const shot = captured;
    assert.notEqual(shot, null);
    assert.equal(shot.headers.authorization, "Bearer sk-test");
    assert.equal(shot.body.model, "test-model");
    assert.deepEqual(shot.body.tools, [SPEC]);
  } finally {
    server.close();
  }
});

test("AnthropicProvider speaks /v1/messages and maps tool_use blocks", async () => {
  let captured = null;
  const server = await startMock(async (req, res) => {
    captured = { headers: req.headers, body: JSON.parse(await readBody(req)) };
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        content: [
          { type: "text", text: "checking" },
          { type: "tool_use", id: "toolu_1", name: "exec", input: { command: "ls" } },
        ],
        stop_reason: "tool_use",
      }),
    );
  });
  try {
    const provider = new AnthropicProvider({
      apiKey: "ak-test",
      model: "claude-test",
      baseURL: `http://127.0.0.1:${server.address().port}`,
      timeoutMs: 2_000,
    });
    const messages = [
      { role: "system", content: "be brief" },
      { role: "user", content: "list files" },
      { role: "assistant", content: "", toolCalls: [{ id: "toolu_9", name: "exec", arguments: { command: "ls" } }] },
      { role: "tool", content: "out", toolCallId: "toolu_9", toolName: "exec" },
    ];
    const result = await provider.complete({ messages, tools: [SPEC] });
    const shot = captured;
    assert.notEqual(shot, null);
    assert.equal(shot.headers["x-api-key"], "ak-test");
    assert.equal(shot.headers["anthropic-version"], "2023-06-01");
    assert.equal(shot.body.system, "be brief");
    assert.equal(shot.body.max_tokens, 8192);
    assert.deepEqual(shot.body.tools, [
      { name: "exec", description: "run a command", input_schema: SPEC.function.parameters },
    ]);
    assert.deepEqual(shot.body.messages[0], {
      role: "user",
      content: [{ type: "text", text: "list files" }],
    });
    assert.deepEqual(shot.body.messages[1], {
      role: "assistant",
      content: [{ type: "tool_use", id: "toolu_9", name: "exec", input: { command: "ls" } }],
    });
    assert.deepEqual(shot.body.messages[2], {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "toolu_9", content: "out" }],
    });
    assert.equal(result.text, "checking");
    assert.equal(result.stopReason, "tool_use");
    assert.equal(result.toolCalls[0].id, "toolu_1");
    assert.deepEqual(result.toolCalls[0].arguments, { command: "ls" });
  } finally {
    server.close();
  }
});

test("OllamaLocalProvider keeps its own name and local defaults", () => {
  const provider = new OllamaLocalProvider({ model: "llama3.1", timeoutMs: 1_000 });
  assert.equal(provider.name, "ollama");
});

test("FallbackProvider skips a failing primary and logs who served", async () => {
  const failing = await startMock((req, res) => {
    res.writeHead(500);
    res.end("boom");
  });
  const working = await startMock(async (req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        choices: [{ message: { role: "assistant", content: "from-backup" }, finish_reason: "stop" }],
      }),
    );
  });
  const logs = [];
  try {
    const chain = [
      new OpenAiProvider({ baseURL: `http://127.0.0.1:${failing.address().port}`, apiKey: "k", model: "m", timeoutMs: 1_000 }),
      new OpenAiProvider({ baseURL: `http://127.0.0.1:${working.address().port}`, apiKey: "k", model: "m", timeoutMs: 1_000 }),
    ];
    const fallback = new FallbackProvider(chain, (message) => logs.push(message));
    const result = await fallback.complete({ messages: [{ role: "user", content: "hi" }], tools: [] });
    assert.equal(result.text, "from-backup");
    assert.equal(fallback.lastServedProvider, "openai");
    assert.ok(logs.some((line) => line.includes('provider "openai" failed')));
    assert.ok(logs.some((line) => line.includes('served by fallback provider "openai"')));
  } finally {
    failing.close();
    working.close();
  }
});

test("FallbackProvider raises a combined error when every provider fails", async () => {
  const failing = await startMock((req, res) => {
    res.writeHead(500);
    res.end("boom");
  });
  try {
    const chain = [
      new OpenAiProvider({ baseURL: `http://127.0.0.1:${failing.address().port}`, apiKey: "k", model: "m", timeoutMs: 1_000 }),
      new OpenAiProvider({ baseURL: "http://127.0.0.1:1", apiKey: "k", model: "m", timeoutMs: 1_000 }),
    ];
    const fallback = new FallbackProvider(chain, () => {});
    await assert.rejects(
      () => fallback.complete({ messages: [{ role: "user", content: "hi" }], tools: [] }),
      /all providers failed/,
    );
  } finally {
    failing.close();
  }
});

test("createProviderFromConfig picks the provider kind and wraps fallbacks", () => {
  const openaiConfig = { llm: { baseURL: "http://x/v1", apiKey: "k", model: "m", timeoutMs: 1_000 } };
  assert.equal(createProviderFromConfig(openaiConfig).name, "openai");

  const anthropicConfig = {
    llm: {
      ...openaiConfig.llm,
      provider: "anthropic",
      anthropic: { apiKey: "ak", model: "claude-x", baseURL: "https://api.anthropic.com", maxTokens: 1024 },
    },
  };
  assert.equal(createProviderFromConfig(anthropicConfig).name, "anthropic");

  const fallbackConfig = {
    llm: { ...openaiConfig.llm, fallbacks: [{ provider: "anthropic", model: "claude-b" }] },
  };
  assert.equal(createProviderFromConfig(fallbackConfig).name, "fallback");

  const chain = describeProviderChain({
    llm: { ...openaiConfig.llm, fallbacks: [{ provider: "ollama", model: "llama3.1" }] },
  });
  assert.equal(chain.length, 2);
  assert.equal(chain[1].kind, "ollama");
  assert.equal(chain[1].endpoint, "http://127.0.0.1:11434/v1");

  const overridden = describeProviderChain(openaiConfig, "custom-model");
  assert.equal(overridden[0].model, "custom-model");
});

test("config validation rejects a bad provider kind and malformed fallbacks", () => {
  const badKind = validateConfig({ llm: { provider: "banana" } });
  assert.ok(badKind.errors.some((error) => error.includes("llm.provider must be one of")));

  const badFallback = validateConfig({ llm: { fallbacks: [{ provider: "openai" }] } });
  assert.ok(badFallback.errors.some((error) => error.includes("llm.fallbacks[0].model")));
});
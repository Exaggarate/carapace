// Built-in tool: web_fetch — GET a URL and return extracted text.
// Plain fetch with a hard timeout; HTML is reduced to readable text, JSON and plain
// text pass through, binary content types are refused. No JS execution, no cookies.

import type { ToolDefinition, ToolResult } from "../registry.js";

const FETCH_TIMEOUT_MS = 20_000;
const BODY_CAP_CHARS = 50_000;

export function createWebFetchTool(): ToolDefinition {
  return {
    name: "web_fetch",
    description:
      "Fetch an http(s) URL with GET and return the response as text. HTML pages are stripped to " +
      "readable text; JSON and plain text are returned as-is; other content types are refused.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Absolute http(s) URL to fetch." },
      },
      required: ["url"],
    },
    async execute(input): Promise<ToolResult> {
      const url = typeof input.url === "string" ? input.url.trim() : "";
      if (url === "") {
        return { ok: false, output: "web_fetch: 'url' is required and must be a non-empty string" };
      }
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return { ok: false, output: `web_fetch: invalid URL: ${url}` };
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return {
          ok: false,
          output: `web_fetch: only http and https URLs are supported (got "${parsed.protocol}")`,
        };
      }

      let response: Response;
      try {
        response = await fetch(parsed.toString(), {
          method: "GET",
          headers: {
            "user-agent": "carapace/0.1",
            accept: "text/*, application/json;q=0.9, */*;q=0.1",
          },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
      } catch (error) {
        return { ok: false, output: `web_fetch: request failed (${(error as Error).message})` };
      }

      if (!response.ok) {
        return { ok: false, output: `web_fetch: HTTP ${response.status} ${response.statusText} for ${url}` };
      }

      const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
      const raw = await response.text();
      if (raw === "") return { ok: true, output: "(empty response body)" };

      if (contentType.includes("text/html") || contentType.includes("application/xhtml")) {
        return { ok: true, output: cap(htmlToText(raw), "html page") };
      }
      if (contentType.includes("json")) {
        return { ok: true, output: cap(raw, "json body") };
      }
      if (contentType === "" || contentType.startsWith("text/")) {
        return { ok: true, output: cap(raw, "text body") };
      }
      return {
        ok: false,
        output: `web_fetch: unsupported content-type "${contentType}" — only text, html, and json are returned`,
      };
    },
  };
}

function cap(text: string, label: string): string {
  if (text.length <= BODY_CAP_CHARS) return text;
  return `${text.slice(0, BODY_CAP_CHARS)}\n[truncated — ${label} holds ${text.length} chars]`;
}

/** Reduce HTML to readable text: drop script/style/comments, strip tags, decode entities. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
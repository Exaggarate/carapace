// M11 conversational-UX formatting core (Telegram surface).
// Agent replies are authored in markdown; Telegram receives them as HTML parse
// mode after conversion here — HTML-escape first so nothing user-supplied can
// form entities, then map the markdown subset agents actually emit:
//   ```fenced code``` → <pre> (with an optional language class),
//   `inline code` → <code>, **bold** → <b>, *italic*/_italic_ → <i>,
//   ~~strike~~ → <s>, __underline__ → <u>, [label](https://…) → <a href>.
// Long replies are chunked at the 4096-char Bot API limit on paragraph
// boundaries — never mid-word, and never inside a fenced code block (a single
// fence larger than the limit is closed at the cut and reopened on the next
// chunk so every chunk stays independently parseable).

export const TELEGRAM_MESSAGE_LIMIT = 4096;

/** Escape the characters that are special inside Telegram's HTML parse mode. */
function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

interface FenceSpan {
  /** Index of the opening ``` marker. */
  open: number;
  /** Index of the closing ``` marker (or text.length when unclosed). */
  close: number;
  /** Language tag from the opening fence line, when present. */
  lang: string;
}

/** Locate fenced code blocks by their ``` markers (pairwise, left to right). */
function collectFences(text: string): FenceSpan[] {
  const spans: FenceSpan[] = [];
  const marker = /```/g;
  let open: { index: number; lang: string } | null = null;
  for (let match = marker.exec(text); match !== null; match = marker.exec(text)) {
    if (open === null) {
      const rest = text.slice(match.index + 3, text.indexOf("\n", match.index));
      open = { index: match.index, lang: rest.trim() };
      marker.lastIndex = match.index + 3;
      continue;
    }
    spans.push({ open: open.index, close: match.index, lang: open.lang });
    open = null;
    marker.lastIndex = match.index + 3;
  }
  if (open !== null) spans.push({ open: open.index, close: text.length, lang: open.lang });
  return spans;
}

/**
 * Split long text into chunks of at most `limit` characters. Cuts prefer
 * paragraph breaks (\n\n), then line breaks, then spaces — a mid-word hard cut
 * is the last resort. A cut that would land inside a fenced code block moves to
 * the fence's closing marker (or before its opening marker); only a single
 * fence larger than the whole limit is hard-split, with the fence closed at the
 * end of one chunk and reopened at the start of the next.
 */
export function splitTelegramText(text: string, limit: number = TELEGRAM_MESSAGE_LIMIT): string[] {
  if (text.length <= limit) return [text];
  const fences = collectFences(text);
  const chunks: string[] = [];
  let start = 0; // absolute index in `text` where the current chunk begins
  let reopenLang: string | null = null; // set when the previous chunk hard-split inside a fence
  while (text.length - start > limit) {
    const rest = text.slice(start);
    const window = rest.slice(0, limit);
    let cut = window.lastIndexOf("\n\n");
    if (cut < limit / 2) cut = window.lastIndexOf("\n");
    if (cut < limit / 2) cut = window.lastIndexOf(" ");
    if (cut < limit / 2) cut = limit;
    // Fence safety in absolute coordinates: a cut strictly inside a fence moves.
    const absCut = start + cut;
    const inside = fences.find((fence) => absCut > fence.open + 3 && absCut < fence.close);
    if (inside !== undefined && inside.close + 3 <= start + limit) {
      cut = inside.close + 3 - start; // close the fence at the end of this chunk
    } else if (inside !== undefined && inside.open > start) {
      cut = inside.open - start; // end the chunk just before the fence opens
      while (cut > 0 && (rest[cut - 1] === "\n" || rest[cut - 1] === " ")) cut -= 1;
      if (cut === 0) cut = inside.open - start;
    } else if (inside !== undefined) {
      // The chunk begins inside this fence: close it at capacity and reopen on
      // the next chunk so every piece stays independently parseable.
      const prefix = reopenLang === null ? "" : `\`\`\`${reopenLang}\n`;
      const fenceStart = Math.max(0, inside.open - start);
      const pre = rest.slice(0, fenceStart);
      const header = rest.slice(fenceStart).match(/^```[^\n]*\n?/)?.[0] ?? "";
      const capacity = Math.max(16, limit - prefix.length - pre.length - header.length - 4);
      const taken = rest.slice(fenceStart + header.length, fenceStart + header.length + capacity);
      chunks.push(`${prefix}${pre}${header}${taken}\n\`\`\``);
      start += fenceStart + header.length + taken.length;
      while (start < text.length && text[start] === "\n") start += 1;
      reopenLang = inside.lang;
      continue;
    }
    chunks.push(`${reopenLang === null ? "" : `\`\`\`${reopenLang}\n`}${rest.slice(0, cut)}`);
    reopenLang = null;
    let next = start + cut;
    if (text[next] === " ") next += 1;
    while (next < text.length && text[next] === "\n") next += 1;
    start = next;
  }
  if (start < text.length || chunks.length === 0) {
    chunks.push(`${reopenLang === null ? "" : `\`\`\`${reopenLang}\n`}${text.slice(start)}`);
  }
  return chunks;
}

/** Convert one chunk of agent markdown into Telegram-parseable HTML. */
export function markdownToTelegramHtml(text: string): string {
  // 1. Pull fenced code blocks out first; placeholders survive the escape pass
  //    and their content is never touched by inline markup rules.
  const blocks: string[] = [];
  const withPlaceholders = text.replace(/```([^\n`]*)\n?([\s\S]*?)(?:```|$)/g, (_match, lang: string, code: string) => {
    const language = lang.trim();
    const inner = escapeHtml(code.replace(/\n$/, ""));
    blocks.push(
      language === ""
        ? `<pre>${inner}</pre>`
        : `<pre><code class="language-${escapeHtml(language)}">${inner}</code></pre>`,
    );
    return `\u0000${blocks.length - 1}\u0000`;
  });

  // 2. Escape everything else so raw user text can never form tags.
  let html = escapeHtml(withPlaceholders);

  // 3. Inline code before emphasis so its content is protected.
  html = html.replace(/`([^`\n]+)`/g, (_match, code: string) => `<code>${code}</code>`);
  // 4. Links before emphasis — URLs may legitimately contain _ and *.
  html = html.replace(
    /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g,
    (_match, label: string, url: string) => `<a href="${url}">${label}</a>`,
  );
  // 5. Emphasis, longest markers first.
  html = html.replace(/~~([^~\n]+)~~/g, "<s>$1</s>");
  html = html.replace(/__([^_\n]+)__/g, "<u>$1</u>");
  html = html.replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");
  html = html.replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s.,!?;:)])/g, "$1<i>$2</i>");
  html = html.replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s.,!?;:)])/g, "$1<i>$2</i>");

  // 6. Restore the fenced blocks.
  return html.replace(/\u0000(\d+)\u0000/g, (_match, index: string) => blocks[Number(index)] ?? "");
}

/** Doctor-facing validation: does this message text convert cleanly for Telegram? */
export function validateTelegramMarkdown(text: string): { ok: boolean; reason: string | null } {
  if (text.trim() === "") return { ok: false, reason: "message text is empty" };
  if (text.includes("\u0000")) return { ok: false, reason: "message text contains NUL placeholders" };
  const markerCount = (text.match(/```/g) ?? []).length;
  if (markerCount % 2 !== 0) return { ok: false, reason: "unclosed code fence (odd number of ``` markers)" };
  return { ok: true, reason: null };
}
/**
 * WhatsApp-first message renderer.
 *
 * WhatsApp syntax is parsed first (bold/italic/strikethrough, inline code,
 * fenced code, quotes, bullet/numbered lists, links). Markdown extras used by
 * AI output (double-asterisk bold, headings, pipe tables) are layered on top.
 *
 * All user text is escaped before tags are emitted. Code/link placeholders are
 * protected so their contents are never reinterpreted as formatting.
 */
((root) => {
  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function isBlockStart(line) {
    return (
      /^\s{0,3}```/.test(line) ||
      /^\s{0,3}>/.test(line) ||
      /^\s{0,3}[-*]\s+/.test(line) ||
      /^\s{0,3}\d+\.\s+/.test(line) ||
      /^\s{0,3}#{1,6}\s+/.test(line)
    );
  }

  function renderInline(raw) {
    const TOKEN = "\uE000";
    const tokens = [];
    const keep = (html) => {
      const token = `${TOKEN}${tokens.length}${TOKEN}`;
      tokens.push(html);
      return token;
    };
    let text = escapeHtml(
      String(raw ?? "")
        .split(TOKEN)
        .join(""),
    );

    // Inline code and links are protected before emphasis parsing.
    text = text.replace(/`([^`\n]+)`/g, (_, code) => keep(`<code>${code}</code>`));
    text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, label, url) =>
      keep(`<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`),
    );
    text = text.replace(/(^|[\s(])(https?:\/\/[^\s<]+|www\.[^\s<]+)/g, (match, lead, rawUrl) => {
      const url = rawUrl.replace(/[.,;:!?]+$/, "");
      const suffix = rawUrl.slice(url.length);
      const href = url.startsWith("www.") ? `https://${url}` : url;
      return `${lead}${keep(
        `<a href="${href}" target="_blank" rel="noopener noreferrer">${url}</a>`,
      )}${suffix}`;
    });

    // Markdown extras first, then WhatsApp single-marker syntax.
    text = text.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    text = text.replace(/__([^_\n]+)__/g, "<strong>$1</strong>");
    text = text.replace(/(^|[^\w])\*([^*\n]+)\*(?!\*)/g, "$1<strong>$2</strong>");
    text = text.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");
    text = text.replace(/(^|[^\w])~([^~\n]+)~(?!~)/g, "$1<del>$2</del>");
    text = text.replace(/(^|[^\w])_([^_\n]+)_(?=$|[^\w])/g, "$1<em>$2</em>");
    text = text.replace(/(^|\s)(@[0-9]{5,16})/g, '$1<span class="msg-mention">$2</span>');

    text = text.replace(/\n/g, "<br />");
    return text.replace(
      new RegExp(`${TOKEN}(\\d+)${TOKEN}`, "g"),
      (_, index) => tokens[Number(index)] ?? "",
    );
  }

  function splitRow(line) {
    return line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim());
  }

  function parseTable(lines, index) {
    if (index + 1 >= lines.length || !lines[index].includes("|")) return null;
    const header = splitRow(lines[index]);
    const separator = splitRow(lines[index + 1]);
    if (
      header.length < 2 ||
      separator.length !== header.length ||
      !separator.every((cell) => /^:?-{3,}:?$/.test(cell))
    ) {
      return null;
    }

    const rows = [];
    let cursor = index + 2;
    while (cursor < lines.length && lines[cursor].includes("|")) {
      rows.push(splitRow(lines[cursor]));
      cursor += 1;
    }

    const head = header.map((cell) => `<th>${renderInline(cell)}</th>`).join("");
    const body = rows
      .map(
        (row) =>
          `<tr>${header
            .map((_, cellIndex) => `<td>${renderInline(row[cellIndex] ?? "")}</td>`)
            .join("")}</tr>`,
      )
      .join("");
    return {
      html: `<div class="msg-table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`,
      next: cursor,
    };
  }

  function render(raw) {
    const lines = String(raw ?? "")
      .replace(/\r\n?/g, "\n")
      .split("\n");
    const output = [];
    let index = 0;

    while (index < lines.length) {
      const line = lines[index];

      const fence = line.match(/^\s{0,3}```/);
      if (fence) {
        const content = [];
        index += 1;
        while (index < lines.length && !/^\s{0,3}```\s*$/.test(lines[index])) {
          content.push(lines[index]);
          index += 1;
        }
        if (index < lines.length) index += 1;
        output.push(`<pre class="msg-code"><code>${escapeHtml(content.join("\n"))}</code></pre>`);
        continue;
      }

      const table = parseTable(lines, index);
      if (table) {
        output.push(table.html);
        index = table.next;
        continue;
      }

      if (/^\s{0,3}>/.test(line)) {
        const quote = [];
        while (index < lines.length && /^\s{0,3}>/.test(lines[index])) {
          quote.push(lines[index].replace(/^\s{0,3}>\s?/, ""));
          index += 1;
        }
        output.push(`<blockquote>${renderInline(quote.join("\n"))}</blockquote>`);
        continue;
      }

      if (/^\s{0,3}[-*]\s+/.test(line)) {
        const items = [];
        while (index < lines.length && /^\s{0,3}[-*]\s+/.test(lines[index])) {
          items.push(lines[index].replace(/^\s{0,3}[-*]\s+/, ""));
          index += 1;
        }
        output.push(`<ul>${items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</ul>`);
        continue;
      }

      if (/^\s{0,3}\d+\.\s+/.test(line)) {
        const items = [];
        while (index < lines.length && /^\s{0,3}\d+\.\s+/.test(lines[index])) {
          items.push(lines[index].replace(/^\s{0,3}\d+\.\s+/, ""));
          index += 1;
        }
        output.push(`<ol>${items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</ol>`);
        continue;
      }

      const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+)$/);
      if (heading) {
        const level = heading[1].length;
        output.push(`<h${level} class="msg-heading">${renderInline(heading[2])}</h${level}>`);
        index += 1;
        continue;
      }

      const normal = [];
      while (index < lines.length && !isBlockStart(lines[index])) {
        normal.push(lines[index]);
        index += 1;
      }
      output.push(renderInline(normal.join("\n")));
    }

    return output.join("");
  }

  root.MessageFormat = { render };
})(typeof window !== "undefined" ? window : globalThis);

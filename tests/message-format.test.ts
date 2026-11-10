import { expect, test } from "bun:test";

// The formatter is a classic dashboard script; importing it attaches the API
// to globalThis in a non-browser test environment.
await import("../src/dashboard-ui/js/lib/messageFormat.js");
const render = (globalThis as { MessageFormat?: { render: (raw: string) => string } }).MessageFormat
  ?.render;

function format(raw: string): string {
  if (!render) throw new Error("MessageFormat not loaded");
  return render(raw);
}

test("uses WhatsApp single-marker formatting", () => {
  expect(format("*bold*")).toContain("<strong>bold</strong>");
  expect(format("_italic_")).toContain("<em>italic</em>");
  expect(format("~strike~")).toContain("<del>strike</del>");
});

test("keeps inline code literal and renders fenced code blocks", () => {
  const inline = format("`*not bold*`");
  expect(inline).toContain("<code>*not bold*</code>");
  expect(inline).not.toContain("<strong>");
  const block = format("```\nline 1\n*literal*\n```");
  expect(block).toContain('<pre class="msg-code">');
  expect(block).toContain("*literal*");
  expect(block).not.toContain("<strong>");
});

test("renders WhatsApp bullet, numbered, and quote blocks", () => {
  expect(format("- one\n- two")).toContain("<ul><li>one</li><li>two</li></ul>");
  expect(format("* one\n* two")).toContain("<ul><li>one</li><li>two</li></ul>");
  expect(format("1. first\n2. second")).toContain("<ol><li>first</li><li>second</li></ol>");
  expect(format("> quoted\n> line")).toContain("<blockquote>quoted<br />line</blockquote>");
  // A line that starts with bold is not a bullet.
  expect(format("*bold*")).not.toContain("<ul>");
});

test("keeps Markdown enrichment for AI-style output", () => {
  expect(format("**markdown bold**")).toContain("<strong>markdown bold</strong>");
  expect(format("## Heading")).toContain('<h2 class="msg-heading">Heading</h2>');
  expect(format("visit https://example.com")).toContain('href="https://example.com"');
});

test("renders pipe tables only in the dashboard and escapes cells", () => {
  const table = format("| Name | Value |\n|---|---|\n| A | 1 |\n| B | 2 |");
  expect(table).toContain("msg-table-wrap");
  expect(table).toContain("<th>Name</th>");
  expect(table).toContain("<td>B</td>");
});

test("escapes message HTML instead of rendering it", () => {
  const output = format('<img src=x onerror="alert(1)">');
  expect(output).toContain("&lt;img");
  expect(output).not.toContain("<img");
});

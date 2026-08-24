import { describe, expect, it } from "vitest";
import { createRemoteFontModePlugin, stripRemoteFontLinks } from "../../config/vite/remoteFonts";

const htmlWithRemoteFonts = `<!doctype html>
<head>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap" rel="stylesheet">
  <link rel="icon" href="/favicon.ico">
</head>`;

describe("offline remote-font Vite mode", () => {
  it("strips Google Fonts links while preserving local links", () => {
    const transformed = stripRemoteFontLinks(htmlWithRemoteFonts);

    expect(transformed).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/);
    expect(transformed).toContain('<link rel="icon" href="/favicon.ico">');
  });

  it("is a no-op when the mode is disabled", () => {
    expect(createRemoteFontModePlugin(false).transformIndexHtml(htmlWithRemoteFonts))
      .toBe(htmlWithRemoteFonts);
  });

  it("removes links through the same Vite transform used by dev and build", () => {
    const transformed = createRemoteFontModePlugin(true).transformIndexHtml(htmlWithRemoteFonts);

    expect(transformed).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/);
    expect(transformed).toContain('<link rel="icon" href="/favicon.ico">');
  });
});

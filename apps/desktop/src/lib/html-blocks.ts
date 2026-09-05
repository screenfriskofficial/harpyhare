import { withDiagramViewport } from "./diagram-viewport";
import { systemDesignHtml } from "./system-design";

const CLOSED_PREVIEW_FENCE_RE = /^```(html|system-design)[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/gim;
const TRAILING_NEWLINE_RE = /\r?\n$/;

export function previewHtml(language: string | null | undefined, code: string): string | null {
  if (code.trim() === "") return null;
  if (language?.toLowerCase() === "html") return withDiagramViewport(code);
  if (language?.toLowerCase() === "system-design") return systemDesignHtml(code);
  return null;
}

export function extractHtmlBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  for (const match of markdown.matchAll(CLOSED_PREVIEW_FENCE_RE)) {
    const code = (match[2] ?? "").replace(TRAILING_NEWLINE_RE, "");
    const html = previewHtml(match[1], code);
    if (html !== null) blocks.push(html);
  }
  return blocks;
}

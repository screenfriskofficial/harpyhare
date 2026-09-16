import { parseSystemDesign, type SystemDesign } from "./system-design";

/**
 * What a preview block of an answer turns into. `code` is the block as the
 * model wrote it: what the copy button hands out, and what tells two clicks
 * on the same block apart from a click on another one.
 */
export type PreviewContent =
  | { kind: "html"; code: string; html: string }
  | { kind: "system-design"; code: string; design: SystemDesign };

const CLOSED_PREVIEW_FENCE_RE = /^```(html|system-design)[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/gim;
const TRAILING_NEWLINE_RE = /\r?\n$/;

export function previewContent(
  language: string | null | undefined,
  code: string,
): PreviewContent | null {
  if (code.trim() === "") return null;
  const lowered = language?.toLowerCase();
  if (lowered === "html") return { kind: "html", code, html: code };
  if (lowered === "system-design") {
    const design = parseSystemDesign(code);
    return design === null ? null : { kind: "system-design", code, design };
  }
  return null;
}

export function extractPreviewBlocks(markdown: string): PreviewContent[] {
  const blocks: PreviewContent[] = [];
  for (const match of markdown.matchAll(CLOSED_PREVIEW_FENCE_RE)) {
    const code = (match[2] ?? "").replace(TRAILING_NEWLINE_RE, "");
    const content = previewContent(match[1], code);
    if (content !== null) blocks.push(content);
  }
  return blocks;
}

export function samePreview(a: PreviewContent, b: PreviewContent): boolean {
  return a.kind === b.kind && a.code === b.code;
}

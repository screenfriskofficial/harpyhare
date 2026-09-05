// The iframe has its own document and cannot inherit the HUD cursor rule.
// First-layer !important also overrides generated unlayered !important rules.
const CURSOR_STYLE =
  '<style id="harpyhare-preview-cursor">@layer harpyhare-cursor { *, *::before, *::after { cursor: default !important; } }</style>';
const HEAD = /<head(?:\s[^>]*)?>/i;
const DOCTYPE = /^(\s*<!doctype[^>]*>)/i;

export function withPreviewCursor(html: string): string {
  if (html === "" || html.includes('id="harpyhare-preview-cursor"')) return html;
  if (HEAD.test(html)) return html.replace(HEAD, (head) => head + CURSOR_STYLE);
  if (DOCTYPE.test(html)) return html.replace(DOCTYPE, (doctype) => doctype + CURSOR_STYLE);
  return CURSOR_STYLE + html;
}

import { t } from "@/i18n";
import viewport from "./diagram-viewport.html?raw";

/** Upgrade only our diagram renderer, including HTML saved by older presets. */
export function withDiagramViewport(html: string): string {
  if (
    !/globalThis\.__LAYOUT\s*=/.test(html) ||
    !/globalThis\.__SVG\s*=/.test(html) ||
    html.includes('id="harpyhare-diagram-viewport"')
  )
    return html;

  const labels = JSON.stringify({
    zoomIn: t("hud.preview.zoomIn"),
    zoomOut: t("hud.preview.zoomOut"),
    actualSize: t("hud.preview.actualSize"),
    fit: t("hud.preview.fit"),
    controls: t("hud.preview.diagramControls"),
    hint: t("hud.preview.panHint"),
  }).replace(/</g, "\\u003c");
  const controls = viewport.replace("__DIAGRAM_LABELS__", () => labels);
  return html.replace(/<\/body\s*>(\s*<\/html\s*>\s*)?$/i, (closing) => controls + closing);
}

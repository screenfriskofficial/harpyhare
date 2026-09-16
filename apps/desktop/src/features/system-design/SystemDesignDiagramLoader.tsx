import { lazyPanel } from "@/components/lazy-panel";

/** The canvas library joins the HUD bundle only once a diagram is actually opened. */
export const SystemDesignDiagramLoader = lazyPanel(
  async () => ({ default: (await import("./SystemDesignDiagram")).SystemDesignDiagram }),
  "hud.preview.loadingDiagram",
);

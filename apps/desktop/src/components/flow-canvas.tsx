import {
  Background,
  Controls,
  ReactFlow,
  type AriaLabelConfig,
  type ColorMode,
  type Edge,
  type FitViewOptions,
  type Node,
  type ReactFlowProps,
} from "@xyflow/react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

/** The dot grid behind every canvas. */
const GRID_GAP_PX = 20;
const GRID_DOT_PX = 1;
/** The app is dark-only; React Flow's own detection looks for a `dark` class the app never sets. */
export const FLOW_COLOR_MODE: ColorMode = "dark";

export function FlowBackground() {
  return <Background gap={GRID_GAP_PX} size={GRID_DOT_PX} />;
}

/** Zoom in, zoom out and fit; whether a canvas is interactive is its own decision, not a button. */
export function FlowControls({ fitViewOptions }: { fitViewOptions?: FitViewOptions }) {
  return <Controls showInteractive={false} fitViewOptions={fitViewOptions} />;
}

/** The accessible names of the zoom controls, worded once for every canvas. */
function flowControlsAriaLabels(t: TFunction): Partial<AriaLabelConfig> {
  return {
    "controls.ariaLabel": t("flow.controls"),
    "controls.zoomIn.ariaLabel": t("flow.zoomIn"),
    "controls.zoomOut.ariaLabel": t("flow.zoomOut"),
    "controls.fitView.ariaLabel": t("flow.fit"),
  };
}

/**
 * `ReactFlow` on the app's terms: the dark colour mode, the dot grid, the
 * zoom controls with their accessible names, then whatever the canvas adds
 * as children. A canvas's own `ariaLabelConfig` entries win over the shared
 * wording, so it only spells out what differs.
 */
export function FlowCanvas<N extends Node = Node, E extends Edge = Edge>({
  ariaLabelConfig,
  children,
  ...props
}: Omit<ReactFlowProps<N, E>, "colorMode">) {
  const { t } = useTranslation();
  return (
    <ReactFlow<N, E>
      {...props}
      colorMode={FLOW_COLOR_MODE}
      ariaLabelConfig={{ ...flowControlsAriaLabels(t), ...ariaLabelConfig }}
    >
      <FlowBackground />
      <FlowControls fitViewOptions={props.fitViewOptions} />
      {children}
    </ReactFlow>
  );
}

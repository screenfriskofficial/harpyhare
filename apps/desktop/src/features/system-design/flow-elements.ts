import type { Node } from "@xyflow/react";
import type { SystemDesign } from "@/lib/system-design";
import {
  layoutSystemDesign,
  type LaidOutGroup,
  type LaidOutNode,
  type RoutedEdge,
} from "@/lib/system-design-layout";

export type CardNode = Node<{ card: LaidOutNode }, "card">;
export type ClusterNode = Node<{ cluster: LaidOutGroup }, "cluster">;
/** An invisible corner, so «fit view» includes the buses and labels beyond the cards. */
export type AnchorNode = Node<Record<string, never>, "anchor">;
export type DesignNode = CardNode | ClusterNode | AnchorNode;

/**
 * The edge overlay sits above the group frames and below the cards (0).
 * React Flow renders the viewport portal after the nodes, so equal z-indexes
 * would fall back to DOM order; the three layers are spelled out instead.
 */
export const EDGE_LAYER_Z = -1;
/** Groups sit under the edges and the cards they enclose. */
export const CLUSTER_Z_INDEX = EDGE_LAYER_Z - 1;
const ANCHOR_SIZE = 1;

export interface DesignElements {
  nodes: DesignNode[];
  edges: RoutedEdge[];
  width: number;
  height: number;
}

/**
 * The model's data as React Flow nodes plus routed edges: sizes come with the
 * nodes, so nothing is hidden while measuring, and the edges are drawn by
 * the diagram itself from the layout's polylines.
 */
export function flowElements(design: SystemDesign): DesignElements {
  const layout = layoutSystemDesign(design);
  const shared = { selectable: false, draggable: false, connectable: false, focusable: false };
  const clusters: ClusterNode[] = layout.groups.map((group) => ({
    id: group.id,
    type: "cluster",
    position: { x: group.x, y: group.y },
    width: group.width,
    height: group.height,
    data: { cluster: group },
    zIndex: CLUSTER_Z_INDEX,
    ...shared,
  }));
  const cards: CardNode[] = layout.nodes.map((node) => ({
    id: node.id,
    type: "card",
    position: { x: node.x, y: node.y },
    width: node.width,
    height: node.height,
    data: { card: node },
    ariaLabel: node.title,
    ...shared,
  }));
  const anchors: AnchorNode[] = [
    { x: 0, y: 0 },
    { x: layout.width - ANCHOR_SIZE, y: layout.height - ANCHOR_SIZE },
  ].map((position, index) => ({
    id: `anchor-${index}`,
    type: "anchor",
    position,
    width: ANCHOR_SIZE,
    height: ANCHOR_SIZE,
    data: {},
    ...shared,
  }));
  return {
    nodes: [...clusters, ...cards, ...anchors],
    edges: layout.edges,
    width: layout.width,
    height: layout.height,
  };
}

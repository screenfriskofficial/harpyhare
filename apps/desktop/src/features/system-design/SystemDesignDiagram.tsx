import {
  ViewportPortal,
  type Edge,
  type NodeMouseHandler,
  type NodeProps,
  type NodeTypes,
  type OnInit,
  type Viewport,
} from "@xyflow/react";
import { Database, Layers, MonitorSmartphone, Server, type LucideIcon } from "lucide-react";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useMemo,
  useState,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";
import { FlowCanvas } from "@/components/flow-canvas";
import type { SystemDesign, SystemDesignKind } from "@/lib/system-design";
import { LABEL_FONT_PX, type Point, type RoutedEdge } from "@/lib/system-design-layout";
import { cn } from "@/lib/utils";
import {
  EDGE_LAYER_Z,
  flowElements,
  type CardNode,
  type ClusterNode,
  type DesignNode,
} from "./flow-elements";
import "@xyflow/react/dist/style.css";
import "@/components/flow-theme.css";

const ICONS: Record<SystemDesignKind, LucideIcon> = {
  client: MonitorSmartphone,
  service: Server,
  db: Database,
  queue: Layers,
};

/** What the viewer clicked: an arrow or a card. */
interface Selection {
  kind: "edge" | "card";
  id: string;
}

/** How a card takes part in the highlight: the clicked one, or an end of a highlighted arrow. */
type Emphasis = "selected" | "related";

interface Highlight {
  cards: Map<string, Emphasis>;
  edges: Set<string>;
  /** Something is selected, so every arrow outside the highlight steps back. */
  active: boolean;
}

const NO_HIGHLIGHT: Highlight = { cards: new Map(), edges: new Set(), active: false };

/**
 * A clicked arrow lights up with the two cards it connects; a clicked card
 * lights up with every arrow it has and the cards at their other ends. A
 * selection that no longer exists (the diagram changed underneath it) counts
 * as none, so a stale click can never dim the whole drawing.
 */
function highlightFor(
  selection: Selection | null,
  design: SystemDesign,
  edges: RoutedEdge[],
): Highlight {
  if (selection === null) return NO_HIGHLIGHT;
  const cards = new Map<string, Emphasis>();
  const lit = new Set<string>();
  if (selection.kind === "edge") {
    const edge = edges.find((item) => item.id === selection.id);
    if (!edge) return NO_HIGHLIGHT;
    lit.add(edge.id);
    cards.set(edge.from, "related");
    cards.set(edge.to, "related");
  } else {
    if (!design.NODES.some((node) => node.id === selection.id)) return NO_HIGHLIGHT;
    for (const edge of edges) {
      if (edge.from !== selection.id && edge.to !== selection.id) continue;
      lit.add(edge.id);
      cards.set(edge.from === selection.id ? edge.to : edge.from, "related");
    }
    cards.set(selection.id, "selected");
  }
  return { cards, edges: lit, active: true };
}

/**
 * Cards read the highlight from context rather than from node data: rebuilding
 * the node objects on every click would drop React Flow's measurements and hide
 * the cards until they are measured again.
 */
const HighlightContext = createContext<Highlight>(NO_HIGHLIGHT);

const Card = memo(function Card({ id, data: { card: data } }: NodeProps<CardNode>) {
  const { t } = useTranslation();
  const emphasis = useContext(HighlightContext).cards.get(id);
  const Icon = ICONS[data.kind];
  return (
    <div
      data-card={id}
      data-emphasis={emphasis}
      className={cn(
        "flex h-full flex-col rounded-lg border bg-card px-3 py-2 text-foreground shadow-raise",
        data.kind === "client" && "rounded-full px-4 text-center",
        data.kind === "db" && "rounded-[50%_/_14px]",
        data.kind === "queue" && "border-dashed",
        emphasis === "selected" && "border-ring ring-2 ring-ring/40",
        emphasis === "related" && "border-ring",
      )}
    >
      <div className="flex items-center gap-1.5 text-hint text-muted-foreground">
        <Icon className="size-3 shrink-0" aria-hidden />
        {t(`hud.preview.kinds.${data.kind}`)}
      </div>
      <p className="truncate text-body font-medium" title={data.title}>
        {data.title}
      </p>
      {data.sub.map((line, index) => (
        <p key={index} className="truncate text-caption text-muted-foreground" title={line}>
          {line}
        </p>
      ))}
      {data.badge !== null && (
        <p className="mt-auto truncate text-hint text-muted-foreground" title={data.badge}>
          <span className="rounded-sm bg-surface-active px-1 py-px">{data.badge}</span>
        </p>
      )}
    </div>
  );
});

const Cluster = memo(function Cluster({ data: { cluster } }: NodeProps<ClusterNode>) {
  return (
    <div className="relative h-full w-full rounded-lg border border-dashed border-muted-foreground/50">
      <span className="absolute top-1 left-2 text-hint text-muted-foreground">{cluster.label}</span>
    </div>
  );
});

function Anchor() {
  return <div aria-hidden />;
}

const NODE_TYPES: NodeTypes = { card: Card, cluster: Cluster, anchor: Anchor };
/** The diagram draws its own arrows (see `EdgeOverlay`); React Flow gets none, and always the same none. */
const NO_EDGES: Edge[] = [];
const FIT_OPTIONS = { padding: 0.05, maxZoom: 1 };
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2;
/** A diagram opens readable: fitted when that keeps the text legible, otherwise at this zoom from its top-left. */
const MIN_INITIAL_ZOOM = 0.8;
const INITIAL_INSET_PX = 8;

const openReadable: OnInit<DesignNode> = (instance) => {
  void instance.fitView(FIT_OPTIONS).then(() => {
    if (instance.getZoom() < MIN_INITIAL_ZOOM) {
      void instance.setViewport({
        x: INITIAL_INSET_PX,
        y: INITIAL_INSET_PX,
        zoom: MIN_INITIAL_ZOOM,
      });
    }
  });
};
const ARROW_ID = "system-design-arrow";
const ARROW_LIT_ID = "system-design-arrow-lit";
const EDGE_STROKE_PX = 1.5;
const EDGE_STROKE_LIT_PX = 2.5;
/** The invisible band around a line that catches clicks: a hairline is too thin to hit. */
const EDGE_HIT_PX = 14;
/** Arrows outside the highlight fade to this so the lit ones stand out. */
const DIMMED_OPACITY = 0.3;
const ASYNC_DASH = "7 5";
const LABEL_HALO_PX = 4;
/** A highlighted arrow's label goes bold; its colour stays, primary and ring are never text colours. */
const LABEL_LIT_WEIGHT = 600;
const ARROW_MARKER = { width: 10, height: 8 };

/** An arrowhead whose tip sits exactly on the end of the line. */
function ArrowMarker({ id, fill }: { id: string; fill: string }) {
  const { width, height } = ARROW_MARKER;
  return (
    <marker
      id={id}
      markerWidth={width}
      markerHeight={height}
      refX={width}
      refY={height / 2}
      orient="auto"
    >
      <path d={`M0,0 L${width},${height / 2} L0,${height} z`} style={{ fill }} />
    </marker>
  );
}

function pathFrom(points: Point[]): string {
  return points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");
}

/**
 * Edges are drawn from the layout's polylines in the viewport's coordinate
 * space: React Flow's own edges would route between handle centres and stack
 * every connection of a busy card onto the same line. Lines come first and
 * labels after them, so a label's halo covers any line crossing it; within
 * each layer the highlighted edges are drawn last, on top of the faded ones.
 */
function EdgeOverlay({
  edges,
  titles,
  width,
  height,
  onSelect,
}: {
  edges: RoutedEdge[];
  titles: Map<string, string>;
  width: number;
  height: number;
  onSelect: (edgeId: string) => void;
}) {
  const { t } = useTranslation();
  const highlight = useContext(HighlightContext);
  const lit = (edge: RoutedEdge) => highlight.edges.has(edge.id);
  const ordered = [...edges].sort((a, b) => Number(lit(a)) - Number(lit(b)));
  const opacity = (edge: RoutedEdge) =>
    highlight.active && !lit(edge) ? DIMMED_OPACITY : undefined;
  const name = (edge: RoutedEdge) => {
    const ends = { from: titles.get(edge.from) ?? edge.from, to: titles.get(edge.to) ?? edge.to };
    return edge.label === null
      ? t("hud.preview.edge", ends)
      : t("hud.preview.edgeLabeled", { ...ends, label: edge.label });
  };
  return (
    <ViewportPortal>
      <svg
        className="pointer-events-none absolute top-0 left-0 overflow-visible"
        style={{ width, height, zIndex: EDGE_LAYER_Z }}
      >
        <defs>
          <ArrowMarker id={ARROW_ID} fill="var(--muted-foreground)" />
          <ArrowMarker id={ARROW_LIT_ID} fill="var(--ring)" />
        </defs>
        {ordered.map((edge) => {
          const isLit = lit(edge);
          const d = pathFrom(edge.points);
          return (
            <g
              key={edge.id}
              role="button"
              aria-label={name(edge)}
              aria-pressed={isLit}
              data-highlighted={isLit || undefined}
              data-dimmed={opacity(edge) !== undefined || undefined}
              style={{ opacity: opacity(edge) }}
              onClick={() => {
                onSelect(edge.id);
              }}
            >
              <path
                d={d}
                fill="none"
                strokeWidth={isLit ? EDGE_STROKE_LIT_PX : EDGE_STROKE_PX}
                strokeDasharray={edge.async ? ASYNC_DASH : undefined}
                markerEnd={`url(#${isLit ? ARROW_LIT_ID : ARROW_ID})`}
                style={{ stroke: isLit ? "var(--ring)" : "var(--muted-foreground)" }}
              />
              <path
                d={d}
                fill="none"
                stroke="transparent"
                strokeWidth={EDGE_HIT_PX}
                style={{ pointerEvents: "stroke" }}
              />
            </g>
          );
        })}
        {ordered.map(
          (edge) =>
            edge.label !== null && (
              <text
                key={`${edge.id}-label`}
                x={edge.labelX}
                y={edge.labelY}
                textAnchor={edge.labelAnchor}
                dominantBaseline="middle"
                fontSize={LABEL_FONT_PX}
                fontWeight={lit(edge) ? LABEL_LIT_WEIGHT : undefined}
                style={{
                  fill: "var(--foreground)",
                  paintOrder: "stroke",
                  stroke: "var(--background)",
                  strokeWidth: LABEL_HALO_PX,
                  strokeLinejoin: "round",
                  opacity: opacity(edge),
                  pointerEvents: "all",
                }}
                onClick={() => {
                  onSelect(edge.id);
                }}
              >
                {edge.label}
              </text>
            ),
        )}
      </svg>
    </ViewportPortal>
  );
}

/**
 * A read-only canvas: pan and zoom, no dragging or wiring — the model owns the
 * structure. A click on an arrow or a card highlights what it is connected to;
 * clicking it again or the empty canvas clears the highlight.
 */
export function SystemDesignDiagram({
  design,
  viewportMemory,
}: {
  design: SystemDesign;
  /** Pan and zoom remembered by the preview across this component's unmounts. */
  viewportMemory: RefObject<Viewport | null>;
}) {
  const { t } = useTranslation();
  const { nodes, edges, width, height } = useMemo(() => flowElements(design), [design]);
  const titles = useMemo(
    () => new Map(design.NODES.map((node) => [node.id, node.title])),
    [design],
  );
  const [selection, setSelection] = useState<Selection | null>(null);
  const highlight = useMemo(
    () => highlightFor(selection, design, edges),
    [selection, design, edges],
  );
  const toggle = useCallback((next: Selection) => {
    setSelection((current) =>
      current?.kind === next.kind && current.id === next.id ? null : next,
    );
  }, []);
  const clear = useCallback(() => {
    setSelection(null);
  }, []);
  const selectEdge = useCallback(
    (id: string) => {
      toggle({ kind: "edge", id });
    },
    [toggle],
  );
  const onNodeClick = useCallback<NodeMouseHandler<DesignNode>>(
    (_event, node) => {
      if (node.type === "card") toggle({ kind: "card", id: node.id });
      else clear();
    },
    [toggle, clear],
  );
  // A remembered view wins over the readable default: the diagram comes back
  // from mini mode, or reopens, exactly where it was left. React Flow reports
  // no viewport change before init, so the memory read here is not yet stale.
  const onInit = useCallback<OnInit<DesignNode>>(
    (instance) => {
      const saved = viewportMemory.current;
      if (saved === null) openReadable(instance);
      else void instance.setViewport(saved);
    },
    [viewportMemory],
  );
  const onViewportChange = useCallback(
    (viewport: Viewport) => {
      viewportMemory.current = viewport;
    },
    [viewportMemory],
  );
  return (
    <div className="flow-canvas flex min-h-0 flex-1 flex-col gap-1.5">
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border bg-background">
        <HighlightContext.Provider value={highlight}>
          <FlowCanvas
            nodes={nodes}
            edges={NO_EDGES}
            nodeTypes={NODE_TYPES}
            onInit={onInit}
            onViewportChange={onViewportChange}
            onNodeClick={onNodeClick}
            onPaneClick={clear}
            minZoom={MIN_ZOOM}
            maxZoom={MAX_ZOOM}
            nodesDraggable={false}
            nodesConnectable={false}
            nodesFocusable={false}
            edgesFocusable={false}
            elementsSelectable={false}
            zoomOnDoubleClick={false}
            fitViewOptions={FIT_OPTIONS}
            aria-label={design.TITLE}
          >
            <EdgeOverlay
              edges={edges}
              titles={titles}
              width={width}
              height={height}
              onSelect={selectEdge}
            />
          </FlowCanvas>
        </HighlightContext.Provider>
      </div>
      <p className="flex flex-wrap gap-x-4 text-hint text-muted-foreground" aria-hidden>
        <span>— {t("hud.preview.legendSync")}</span>
        <span>- - {t("hud.preview.legendAsync")}</span>
        <span>┄ {t("hud.preview.legendGroup")}</span>
        <span>{t("hud.preview.legendSelect")}</span>
      </p>
    </div>
  );
}

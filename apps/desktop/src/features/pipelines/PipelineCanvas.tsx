import {
  Handle,
  MarkerType,
  Position,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import {
  FileText,
  Folder,
  History,
  MessageSquare,
  NotebookText,
  Sparkles,
  Text,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FlowCanvas } from "@/components/flow-canvas";
import type {
  Pipeline,
  PipelineInput,
  PipelineNode,
  PipelineNodeKind,
  PipelineNodeResult,
} from "@/lib/pipeline-types";
import {
  canConnectPipelineNodes,
  connectPipelineNodes,
  isPipelinePort,
  movePipelineNodes,
  pipelineNodeLabel,
  removePipelineItems,
  type PipelineConnection,
} from "@/lib/pipelines";
import { cn } from "@/lib/utils";
import {
  CANVAS_ZOOM,
  FIT_VIEW_OPTIONS,
  inputPorts,
  keepMeasurements,
  NODE_WIDTH,
  nodeSummary,
  PORT_ROW_PX,
  PORT_STEP_PX,
} from "./editor-model";
import "@xyflow/react/dist/style.css";
import "@/components/flow-theme.css";
import "./pipeline.css";

type FlowNode = Node<
  { node: PipelineNode; summary: string; result?: PipelineNodeResult },
  "pipeline"
>;
const ICONS: Record<PipelineNodeKind, LucideIcon> = {
  document: FileText,
  folder: Folder,
  preset: NotebookText,
  text: Text,
  message: MessageSquare,
  history: History,
  chatContext: NotebookText,
  llm: Sparkles,
  output: Workflow,
};
/** Where the first port row starts from the card's top: the kind line, the title and their gaps. */
const PORT_START_PX = 76;
/** A connection dropped on the card body, not on a port, lands on the data input. */
const DEFAULT_PORT = "input";

const PipelineNodeCard = memo(function PipelineNodeCard({
  data,
  selected,
  isConnectable,
}: NodeProps<FlowNode>) {
  const { t } = useTranslation();
  const { node, result } = data;
  const Icon = ICONS[node.kind];
  const ports = inputPorts(node);
  const label = pipelineNodeLabel(node);
  return (
    <div
      className={cn(
        "pipeline-node rounded-lg border bg-card p-3 text-foreground shadow-raise",
        selected && "border-ring ring-1 ring-ring/40",
        result?.status === "error" && "border-destructive",
        !node.enabled && "opacity-60",
      )}
      style={{ width: NODE_WIDTH }}
    >
      <div className="flex items-center gap-2">
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="text-hint text-muted-foreground">
          {t(`pipelines.nodeTypes.${node.kind}`)}
        </span>
      </div>
      <p className="mt-1 truncate text-body font-medium" title={label}>
        {label}
      </p>
      {ports.length > 0 ? (
        <div className="mt-2 flex flex-col" style={{ gap: PORT_STEP_PX - PORT_ROW_PX }}>
          {ports.map((port, index) => (
            <div
              key={port}
              className="text-hint text-muted-foreground"
              style={{ height: PORT_ROW_PX }}
            >
              <Handle
                type="target"
                id={port}
                position={Position.Left}
                isConnectable={isConnectable}
                style={{ top: PORT_START_PX + index * PORT_STEP_PX }}
                title={t(`pipelines.ports.${port}`)}
                aria-label={t(`pipelines.ports.${port}`)}
              />
              {t(`pipelines.ports.${port}`)}
            </div>
          ))}
        </div>
      ) : null}
      <p className="mt-2 line-clamp-2 text-caption text-muted-foreground" title={data.summary}>
        {data.summary}
      </p>
      {result && (
        <p
          className={cn(
            "mt-2 text-hint",
            result.status === "error" ? "text-destructive" : "text-muted-foreground",
          )}
          role={result.status === "running" ? "status" : undefined}
        >
          {t(`pipelines.statuses.${result.status}`)}
        </p>
      )}
      {!node.enabled && !result && (
        <p className="mt-2 text-hint text-muted-foreground">{t("pipelines.statuses.skipped")}</p>
      )}
      {node.kind !== "output" && (
        <Handle
          type="source"
          position={Position.Right}
          isConnectable={isConnectable}
          title={t("pipelines.editor.sourceHandle")}
          aria-label={t("pipelines.editor.sourceHandle")}
        />
      )}
    </div>
  );
});

const NODE_TYPES = { pipeline: PipelineNodeCard };

function connectionOf(value: Connection | Edge): PipelineConnection {
  const handle = value.targetHandle ?? DEFAULT_PORT;
  return {
    source: value.source,
    target: value.target,
    targetPort: isPipelinePort(handle) ? handle : DEFAULT_PORT,
  };
}

export function PipelineCanvas({
  pipeline,
  input,
  selectedId,
  results,
  onSelect,
  onChange,
  onLayout,
  disabled,
}: {
  pipeline: Pipeline;
  input: PipelineInput;
  selectedId: string | null;
  results: PipelineNodeResult[];
  onSelect: (id: string | null) => void;
  /** A structural edit: nodes, connections. */
  onChange: (pipeline: Pipeline) => void;
  /** Cards moved; nothing the run reads has changed. */
  onLayout: (pipeline: Pipeline) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const [error, setError] = useState(false);
  const resultById = useMemo(
    () => new Map(results.map((result) => [result.nodeId, result])),
    [results],
  );
  // `t` is a dependency so that the summaries follow a language change.
  const flowNodes = useMemo<FlowNode[]>(
    () =>
      pipeline.nodes.map((node) => ({
        id: node.id,
        type: "pipeline",
        position: node.position,
        selected: selectedId === node.id,
        data: { node, summary: nodeSummary(node, input), result: resultById.get(node.id) },
        ariaLabel: `${t(`pipelines.nodeTypes.${node.kind}`)}: ${pipelineNodeLabel(node)}`,
      })),
    [pipeline.nodes, input, resultById, selectedId, t],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(flowNodes);
  useEffect(() => {
    setNodes((current) => keepMeasurements(current, flowNodes));
  }, [flowNodes, setNodes]);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const edges = useMemo<Edge[]>(
    () =>
      pipeline.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        targetHandle: edge.targetPort,
        type: "smoothstep",
        selected: selectedEdgeId === edge.id,
        label: edge.targetPort === "input" ? undefined : t(`pipelines.ports.${edge.targetPort}`),
        markerEnd: { type: MarkerType.ArrowClosed },
      })),
    [pipeline.edges, selectedEdgeId, t],
  );
  const dragging = useRef(false);
  const syncSelection = (changes: NodeChange<FlowNode>[]) => {
    const selected = changes.find((change) => change.type === "select" && change.selected);
    if (selected?.type === "select" && selected.id !== selectedId) onSelect(selected.id);
  };
  // React Flow also moves nodes from the keyboard, without a drag-stop event.
  const syncPositions = (changes: NodeChange<FlowNode>[]) => {
    if (disabled || dragging.current) return;
    const positions = new Map(
      changes.flatMap((change) =>
        change.type === "position" && change.position
          ? [[change.id, change.position] as const]
          : [],
      ),
    );
    if (positions.size > 0) onLayout(movePipelineNodes(pipeline, positions));
  };

  return (
    <div className="flow-canvas pipeline-canvas relative h-full min-h-72 overflow-hidden rounded-lg border bg-background">
      {error && (
        <p
          role="alert"
          className="absolute top-2 left-2 z-10 max-w-xs rounded-md border bg-popover p-2 text-caption text-destructive"
        >
          {t("pipelines.editor.invalidConnection")}
        </p>
      )}
      <FlowCanvas<FlowNode>
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodesChange={(changes) => {
          onNodesChange(changes);
          syncSelection(changes);
          syncPositions(changes);
        }}
        onEdgesChange={(changes) => {
          const selected = changes.find((change) => change.type === "select" && change.selected);
          if (selected?.type === "select") setSelectedEdgeId(selected.id);
        }}
        onNodeClick={(_event, node) => {
          onSelect(node.id);
        }}
        onEdgeClick={(_event, edge) => {
          setSelectedEdgeId(edge.id);
        }}
        onPaneClick={() => {
          onSelect(null);
          setSelectedEdgeId(null);
          setError(false);
        }}
        onNodeDragStart={() => {
          dragging.current = true;
        }}
        onNodeDragStop={(_event, _node, moved) => {
          dragging.current = false;
          onLayout(
            movePipelineNodes(pipeline, new Map(moved.map((node) => [node.id, node.position]))),
          );
        }}
        onDelete={({ nodes: removedNodes, edges: removedEdges }) => {
          if (disabled) return;
          onChange(
            removePipelineItems(pipeline, {
              nodeIds: removedNodes.map((node) => node.id),
              edgeIds: removedEdges.map((edge) => edge.id),
            }),
          );
        }}
        onConnect={(value) => {
          try {
            onChange(connectPipelineNodes(pipeline, connectionOf(value)));
            setError(false);
          } catch {
            setError(true);
          }
        }}
        isValidConnection={(value) =>
          canConnectPipelineNodes(pipeline, connectionOf(value)) === null
        }
        nodesDraggable={!disabled}
        nodesConnectable={!disabled}
        edgesReconnectable={false}
        deleteKeyCode={disabled ? null : ["Backspace", "Delete"]}
        fitView
        fitViewOptions={FIT_VIEW_OPTIONS}
        minZoom={CANVAS_ZOOM.min}
        maxZoom={CANVAS_ZOOM.max}
        aria-label={t("pipelines.editor.diagram")}
        // The zoom controls are worded by `FlowCanvas`; only the editing hints are this canvas's own.
        ariaLabelConfig={{
          "node.a11yDescription.default": t("pipelines.flow.nodeHelp"),
          "node.a11yDescription.keyboardDisabled": t("pipelines.flow.nodeStaticHelp"),
          "node.a11yDescription.ariaLiveMessage": ({ x, y }) =>
            `${t("pipelines.flow.moved")}: x ${x}, y ${y}`,
          "edge.a11yDescription.default": t("pipelines.flow.edgeHelp"),
          "handle.ariaLabel": t("pipelines.editor.connect"),
        }}
      />
    </div>
  );
}

import { GitBranch, List, Play, Plus, Redo2, Square, Undo2, Workflow } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { SelectItem } from "@/components/ui/select";
import { SettingSelect } from "@/features/launcher/fields";
import type { ModelInfo } from "@/lib/models";
import type {
  Pipeline,
  PipelineInput,
  PipelineNodeKind,
  PipelineNodeResult,
  PipelineResult,
} from "@/lib/pipeline-types";
import {
  allowedNodeKinds,
  createPipelineNode,
  describePipelineIssue,
  isPipelineNodeKind,
  pipelineNodeLabel,
  previewPipeline,
  semanticPipelineFingerprint,
} from "@/lib/pipelines";
import { cn } from "@/lib/utils";
import { arrangePipeline, nextNodePosition } from "./editor-model";
import { PipelineCanvas } from "./PipelineCanvas";
import { PipelineInspector } from "./PipelineInspector";
import { PipelineList } from "./PipelineList";
import { PipelinePreview } from "./PipelinePreview";

interface PipelineEditorProps {
  pipeline: Pipeline;
  onChange: (pipeline: Pipeline) => void;
  input: PipelineInput;
  models: ModelInfo[];
  busy?: boolean;
  results?: PipelineNodeResult[];
  result?: PipelineResult | null;
  /** The fingerprint the shown result was produced from; `undefined` means it was never run. */
  resultFingerprint?: string;
  error?: string | null;
  onRun?: () => void;
  onCancel?: () => void;
}

const HISTORY_LIMIT = 80;
const CANVAS_MIN_WIDTH = 740;
const DEFAULT_ADD_KIND: PipelineNodeKind = "folder";
const EMPTY_RESULTS: PipelineNodeResult[] = [];
const PANELS = ["settings", "composition", "result"] as const;
type Panel = (typeof PANELS)[number];

/**
 * Editing, undo history, selection and the three inspector panels of one
 * pipeline. Mount it with `key={pipeline.id}`: switching pipelines is a fresh
 * editor, not a reset of this one.
 */
export function PipelineEditor({
  pipeline,
  onChange,
  input,
  models,
  busy = false,
  results = EMPTY_RESULTS,
  result = null,
  resultFingerprint,
  error = null,
  onRun,
  onCancel,
}: PipelineEditorProps) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(true);
  const [view, setView] = useState<"diagram" | "list">("diagram");
  const [addKind, setAddKind] = useState<PipelineNodeKind>(DEFAULT_ADD_KIND);
  // Nothing is selected until the user picks a card: the composition of the
  // output is the natural first thing to look at, and it needs no selection.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>("composition");
  const [past, setPast] = useState<Pipeline[]>([]);
  const [future, setFuture] = useState<Pipeline[]>([]);
  const fingerprint = useMemo(
    () => semanticPipelineFingerprint(pipeline, input),
    [pipeline, input],
  );
  const preview = useMemo(() => previewPipeline(pipeline, input), [pipeline, input]);
  const kinds = allowedNodeKinds(pipeline.kind);
  const effectiveAddKind = kinds.includes(addKind) ? addKind : DEFAULT_ADD_KIND;
  const selected = pipeline.nodes.find((node) => node.id === selectedId) ?? null;
  const displayedResults = results.length > 0 ? results : (result?.nodes ?? EMPTY_RESULTS);
  const stale = resultFingerprint !== undefined && resultFingerprint !== fingerprint;

  useEffect(() => {
    const element = rootRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setNarrow(entry.contentRect.width < CANVAS_MIN_WIDTH);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  const change = (next: Pipeline) => {
    if (busy || next === pipeline) return;
    setPast((history) => [...history, pipeline].slice(-HISTORY_LIMIT));
    setFuture([]);
    onChange(next);
  };
  // Moving cards is not an edit to undo: an arrow key held down would fill
  // the history with positions and push the real edits out of it.
  const layout = (next: Pipeline) => {
    if (busy || next === pipeline) return;
    onChange(next);
  };
  const undo = () => {
    const previous = past.at(-1);
    if (!previous || busy) return;
    setPast(past.slice(0, -1));
    setFuture([pipeline, ...future]);
    onChange(previous);
  };
  const redo = () => {
    const next = future[0];
    if (!next || busy) return;
    setFuture(future.slice(1));
    setPast([...past, pipeline]);
    onChange(next);
  };
  const select = (id: string | null) => {
    setSelectedId(id);
    setPanel(
      id === null || pipeline.nodes.find((node) => node.id === id)?.kind === "output"
        ? "composition"
        : "settings",
    );
  };
  const add = () => {
    const sourceId =
      effectiveAddKind === "document"
        ? (input.library.docs[0]?.id ?? "")
        : effectiveAddKind === "preset"
          ? (input.presets[0]?.id ?? "")
          : "";
    const node = createPipelineNode(effectiveAddKind, {
      name: t(`pipelines.nodeTypes.${effectiveAddKind}`),
      sourceId,
      position: nextNodePosition(pipeline),
    });
    change({ ...pipeline, nodes: [...pipeline.nodes, node] });
    setSelectedId(node.id);
    setPanel("settings");
  };
  const heading = selected ? pipelineNodeLabel(selected) : t("pipelines.editor.output");

  return (
    <div
      ref={rootRef}
      data-narrow={narrow}
      className="pipeline-editor flex h-full min-h-0 flex-1 flex-col gap-2.5"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="w-40">
          <SettingSelect
            ariaLabel={t("pipelines.editor.selectType")}
            value={effectiveAddKind}
            disabled={busy}
            onValueChange={(value) => {
              if (isPipelineNodeKind(value)) setAddKind(value);
            }}
          >
            {kinds.map((kind) => (
              <SelectItem key={kind} value={kind}>
                {t(`pipelines.nodeTypes.${kind}`)}
              </SelectItem>
            ))}
          </SettingSelect>
        </div>
        <Button size="sm" variant="secondary" disabled={busy} onClick={add}>
          <Plus />
          {t("pipelines.editor.add")}
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          title={t("pipelines.editor.undo")}
          aria-label={t("pipelines.editor.undo")}
          disabled={busy || past.length === 0}
          onClick={undo}
        >
          <Undo2 />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          title={t("pipelines.editor.redo")}
          aria-label={t("pipelines.editor.redo")}
          disabled={busy || future.length === 0}
          onClick={redo}
        >
          <Redo2 />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          title={t("pipelines.editor.arrange")}
          aria-label={t("pipelines.editor.arrange")}
          disabled={busy}
          onClick={() => {
            layout(arrangePipeline(pipeline));
          }}
        >
          <Workflow />
        </Button>
        {!narrow && (
          <div className="ml-auto flex gap-1">
            <Button
              size="icon-xs"
              variant={view === "diagram" ? "secondary" : "ghost"}
              title={t("pipelines.editor.diagram")}
              aria-label={t("pipelines.editor.diagram")}
              aria-pressed={view === "diagram"}
              onClick={() => {
                setView("diagram");
              }}
            >
              <GitBranch />
            </Button>
            <Button
              size="icon-xs"
              variant={view === "list" ? "secondary" : "ghost"}
              title={t("pipelines.editor.list")}
              aria-label={t("pipelines.editor.list")}
              aria-pressed={view === "list"}
              onClick={() => {
                setView("list");
              }}
            >
              <List />
            </Button>
          </div>
        )}
        {busy ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={onCancel === undefined}
            onClick={onCancel}
          >
            <Square />
            {t("pipelines.editor.cancel")}
          </Button>
        ) : (
          onRun !== undefined && (
            <Button
              size="sm"
              disabled={preview.issues.length > 0}
              onClick={() => {
                setPanel("result");
                onRun();
              }}
            >
              <Play />
              {t("pipelines.editor.run")}
            </Button>
          )
        )}
      </div>
      {error !== null && (
        <p
          role="alert"
          className="max-h-20 overflow-auto rounded-md border border-destructive/30 p-2 text-caption whitespace-pre-wrap text-destructive"
        >
          {error}
        </p>
      )}
      {preview.issues.length > 0 && (
        <details className="rounded-md border border-destructive/30 bg-card px-2 py-1 text-caption">
          <summary className="text-destructive">
            {t("pipelines.editor.fixIssues")} · {preview.issues.length}
          </summary>
          <ul className="mt-1 flex flex-col gap-1 pb-1">
            {preview.issues.map((issue, index) => (
              <li key={`${issue.code}-${String(index)}`}>
                <button
                  type="button"
                  className="text-left text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    if (issue.nodeId) select(issue.nodeId);
                  }}
                >
                  {describePipelineIssue(pipeline, issue)}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="pipeline-workspace">
        {narrow || view === "list" ? (
          <PipelineList
            pipeline={pipeline}
            selectedId={selectedId}
            results={displayedResults}
            onSelect={select}
          />
        ) : (
          <PipelineCanvas
            pipeline={pipeline}
            input={input}
            selectedId={selectedId}
            results={displayedResults}
            onSelect={select}
            onChange={change}
            onLayout={layout}
            disabled={busy}
          />
        )}
        <aside
          className="pipeline-inspector flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-3"
          aria-label={t("pipelines.editor.preview")}
        >
          <h3 className="truncate text-body font-medium" title={heading}>
            {heading}
          </h3>
          <div
            className="flex flex-wrap gap-1"
            role="group"
            aria-label={t("pipelines.editor.panelTabs")}
          >
            {PANELS.map((tab) => (
              <Button
                key={tab}
                size="xs"
                variant={panel === tab ? "secondary" : "ghost"}
                aria-pressed={panel === tab}
                disabled={tab === "settings" && selected === null}
                onClick={() => {
                  setPanel(tab);
                }}
              >
                {t(`pipelines.editor.${tab}`)}
              </Button>
            ))}
          </div>
          {panel === "settings" && selected ? (
            <PipelineInspector
              pipeline={pipeline}
              node={selected}
              input={input}
              models={models}
              onChange={change}
              disabled={busy}
            />
          ) : (
            <PipelinePreview
              key={`${selectedId ?? "output"}-${panel}`}
              pipeline={pipeline}
              preview={preview}
              result={result}
              results={displayedResults}
              node={selected}
              executed={panel === "result"}
              stale={stale}
            />
          )}
        </aside>
      </div>
      <p className={cn("text-hint text-muted-foreground", busy && "text-foreground")} role="status">
        {busy
          ? t("pipelines.editor.running")
          : `${t("pipelines.editor.nodes")}: ${pipeline.nodes.length}`}
      </p>
    </div>
  );
}

import { useTranslation } from "react-i18next";
import type { Pipeline, PipelineNodeResult } from "@/lib/pipeline-types";
import { incomingEdges, pipelineNodeLabel } from "@/lib/pipelines";
import { cn } from "@/lib/utils";

/** The narrow-window stand-in for the canvas: the same cards as a list, with their inputs spelled out. */
export function PipelineList({
  pipeline,
  selectedId,
  results,
  onSelect,
}: {
  pipeline: Pipeline;
  selectedId: string | null;
  results: PipelineNodeResult[];
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  const resultById = new Map(results.map((result) => [result.nodeId, result]));
  const nodeById = new Map(pipeline.nodes.map((node) => [node.id, node]));
  return (
    // Tailwind's preflight strips list styling, and Safari drops the list
    // semantics with it; the explicit role keeps the item count announced.
    <ul
      role="list"
      className="flex min-h-0 flex-col gap-1.5 overflow-y-auto"
      aria-label={t("pipelines.editor.list")}
    >
      {pipeline.nodes.length === 0 && (
        <li className="rounded-lg border border-dashed p-5 text-caption text-muted-foreground">
          {t("pipelines.editor.selectHint")}
        </li>
      )}
      {pipeline.nodes.map((node) => {
        const result = resultById.get(node.id);
        return (
          <li key={node.id}>
            <button
              type="button"
              aria-pressed={selectedId === node.id}
              onClick={() => {
                onSelect(node.id);
              }}
              className={cn(
                "flex w-full flex-col gap-1 rounded-lg border bg-card p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                selectedId === node.id && "border-ring bg-surface-active",
              )}
            >
              <span className="text-hint text-muted-foreground">
                {t(`pipelines.nodeTypes.${node.kind}`)}
                {result ? ` · ${t(`pipelines.statuses.${result.status}`)}` : ""}
              </span>
              <span className="text-body font-medium">{pipelineNodeLabel(node)}</span>
              {incomingEdges(pipeline, node.id).map((edge) => {
                const source = nodeById.get(edge.source);
                return (
                  <span key={edge.id} className="text-caption text-muted-foreground">
                    {source ? pipelineNodeLabel(source) : t("pipelines.editor.missing")} →{" "}
                    {t(`pipelines.ports.${edge.targetPort}`)}
                  </span>
                );
              })}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

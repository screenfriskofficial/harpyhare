import { ArrowDown, ArrowUp, Unlink } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { SelectItem } from "@/components/ui/select";
import type { Pipeline, PipelineNode, PipelinePort } from "@/lib/pipeline-types";
import {
  canConnectPipelineNodes,
  connectPipelineNodes,
  incomingEdges,
  isPipelinePort,
  movePipelineEdge,
  pipelineNodeLabel,
  removePipelineEdge,
} from "@/lib/pipelines";
import { inputPorts } from "./editor-model";
import { PipelineSelectField } from "./fields";

const NO_SOURCE_VALUE = "none";

export function PipelineConnections({
  pipeline,
  node,
  onChange,
}: {
  pipeline: Pipeline;
  node: PipelineNode;
  onChange: (pipeline: Pipeline) => void;
}) {
  const { t } = useTranslation();
  const [source, setSource] = useState("");
  const [port, setPort] = useState<PipelinePort>("input");
  const ports = inputPorts(node);
  const selectedPort = ports.includes(port) ? port : ports[0];
  const incoming = incomingEdges(pipeline, node.id);
  const nodeById = new Map(pipeline.nodes.map((candidate) => [candidate.id, candidate]));
  const validSources = pipeline.nodes.filter(
    (candidate) =>
      selectedPort !== undefined &&
      canConnectPipelineNodes(pipeline, {
        source: candidate.id,
        target: node.id,
        targetPort: selectedPort,
      }) === null,
  );
  const validSource = validSources.some((candidate) => candidate.id === source) ? source : "";
  if (ports.length === 0) return null;

  return (
    <section className="flex flex-col gap-2 border-t pt-3">
      <h3 className="text-body font-medium">{t("pipelines.editor.incoming")}</h3>
      {incoming.length === 0 && (
        <p className="text-caption text-muted-foreground">{t("pipelines.editor.noIncoming")}</p>
      )}
      <ol className="flex flex-col gap-1">
        {incoming.map((edge, index) => {
          const from = nodeById.get(edge.source);
          const fromLabel = from ? pipelineNodeLabel(from) : t("pipelines.editor.missing");
          return (
            <li key={edge.id} className="flex items-center gap-1 rounded-md bg-surface px-2 py-1">
              <div className="min-w-0 flex-1">
                <p className="truncate text-caption" title={fromLabel}>
                  {fromLabel}
                </p>
                <p className="text-hint text-muted-foreground">
                  {t(`pipelines.ports.${edge.targetPort}`)}
                </p>
              </div>
              <Button
                size="icon-xs"
                variant="ghost"
                title={t("pipelines.editor.up")}
                aria-label={t("pipelines.editor.up")}
                disabled={index === 0}
                onClick={() => {
                  onChange(movePipelineEdge(pipeline, edge.id, -1));
                }}
              >
                <ArrowUp />
              </Button>
              <Button
                size="icon-xs"
                variant="ghost"
                title={t("pipelines.editor.down")}
                aria-label={t("pipelines.editor.down")}
                disabled={index === incoming.length - 1}
                onClick={() => {
                  onChange(movePipelineEdge(pipeline, edge.id, 1));
                }}
              >
                <ArrowDown />
              </Button>
              <Button
                size="icon-xs"
                variant="ghost"
                title={t("pipelines.editor.disconnect")}
                aria-label={t("pipelines.editor.disconnect")}
                onClick={() => {
                  onChange(removePipelineEdge(pipeline, edge.id));
                }}
              >
                <Unlink />
              </Button>
            </li>
          );
        })}
      </ol>
      <PipelineSelectField
        label={t("pipelines.editor.port")}
        value={selectedPort ?? ""}
        onValueChange={(value) => {
          if (isPipelinePort(value)) setPort(value);
        }}
      >
        {ports.map((item) => (
          <SelectItem key={item} value={item}>
            {t(`pipelines.ports.${item}`)}
          </SelectItem>
        ))}
      </PipelineSelectField>
      <PipelineSelectField
        label={t("pipelines.editor.from")}
        value={validSource === "" ? NO_SOURCE_VALUE : validSource}
        onValueChange={(value) => {
          setSource(value === NO_SOURCE_VALUE ? "" : value);
        }}
      >
        <SelectItem value={NO_SOURCE_VALUE}>{t("pipelines.editor.noSource")}</SelectItem>
        {validSources.map((candidate) => (
          <SelectItem key={candidate.id} value={candidate.id}>
            {pipelineNodeLabel(candidate)}
          </SelectItem>
        ))}
      </PipelineSelectField>
      <Button
        size="sm"
        variant="secondary"
        disabled={validSource === "" || selectedPort === undefined}
        onClick={() => {
          if (selectedPort === undefined || validSource === "") return;
          onChange(
            connectPipelineNodes(pipeline, {
              source: validSource,
              target: node.id,
              targetPort: selectedPort,
            }),
          );
          setSource("");
        }}
      >
        {t("pipelines.editor.connect")}
      </Button>
    </section>
  );
}

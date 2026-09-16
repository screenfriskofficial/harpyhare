import { Copy } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AnswerMarkdown } from "@/components/AnswerMarkdown";
import { Button } from "@/components/ui/button";
import { copyTextReportingError } from "@/lib/clipboard-text";
import type {
  Pipeline,
  PipelineNode,
  PipelineNodeResult,
  PipelineResult,
} from "@/lib/pipeline-types";
import { describePipelineIssue, type PipelinePreview as Preview } from "@/lib/pipelines";
import { PipelineRequestView } from "./PipelineRequestView";

export function PipelinePreview({
  pipeline,
  preview,
  result,
  results,
  node,
  executed,
  stale,
}: {
  pipeline: Pipeline;
  preview: Preview;
  result: PipelineResult | null;
  results: PipelineNodeResult[];
  node: PipelineNode | null;
  executed: boolean;
  stale: boolean;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const actualNode =
    results.find((item) => item.nodeId === node?.id) ??
    result?.nodes.find((item) => item.nodeId === node?.id);
  const staticNode = preview.nodes.find((item) => item.nodeId === node?.id);
  const current = executed ? actualNode : staticNode;
  const text =
    node === null || node.kind === "output"
      ? executed
        ? (result?.text ?? current?.text ?? "")
        : preview.text
      : (current?.text ?? "");
  const unresolved =
    !executed &&
    (current?.status === "waiting" ||
      ((node === null || node.kind === "output") && !preview.complete));
  const available = executed ? result !== null || actualNode !== undefined : true;
  const issue = preview.issues.find((item) => item.nodeId === node?.id);
  const errorText = executed
    ? current?.error
    : issue
      ? describePipelineIssue(pipeline, issue)
      : undefined;
  return (
    <section className="flex min-h-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-caption text-muted-foreground">
          {executed ? t("pipelines.editor.savedRun") : t("pipelines.editor.composition")}
        </span>
        <Button
          size="icon-xs"
          variant="ghost"
          title={t("pipelines.editor.copy")}
          aria-label={t("pipelines.editor.copy")}
          disabled={text === "" || unresolved}
          onClick={() => {
            // The shared clipboard path toasts a failure; only success is shown here.
            void copyTextReportingError(text).then((ok) => {
              if (ok) setCopied(true);
            });
          }}
        >
          <Copy />
        </Button>
      </div>
      {executed && stale && (
        <p role="status" className="rounded-md border border-ring/30 bg-surface p-2 text-caption">
          {t("pipelines.editor.stale")}
        </p>
      )}
      {unresolved && (
        <p className="rounded-md bg-surface p-2 text-caption text-muted-foreground">
          {t("pipelines.editor.noModelPreview")}
        </p>
      )}
      {current && executed && (
        <p className="text-caption text-muted-foreground" role="status">
          {t(`pipelines.statuses.${current.status}`)}
        </p>
      )}
      {errorText !== undefined && (
        <p role="alert" className="text-caption whitespace-pre-wrap text-destructive">
          {errorText}
        </p>
      )}
      {node?.kind === "llm" &&
        node.enabled &&
        (current?.request ? (
          <PipelineRequestView
            request={current.request}
            complete={current.requestComplete === true}
            executed={executed}
          />
        ) : (
          <p className="text-caption text-muted-foreground">
            {t("pipelines.editor.requestUnavailable")}
          </p>
        ))}
      {node?.kind === "llm" && (
        <h4 className="text-caption font-medium">{t("pipelines.editor.nodeResponse")}</h4>
      )}
      {!available ? (
        <p className="text-caption text-muted-foreground">{t("pipelines.editor.resultEmpty")}</p>
      ) : text === "" ? (
        <p className="min-h-20 rounded-md bg-background p-3 text-body text-muted-foreground">
          {unresolved ? t("pipelines.editor.noResult") : t("pipelines.editor.emptyText")}
        </p>
      ) : (
        // Materials and answers are markdown: the same block as an answer in the HUD.
        <div className="max-h-[30rem] min-h-20 overflow-auto rounded-md bg-background p-3 [overflow-wrap:anywhere]">
          <AnswerMarkdown text={text} />
        </div>
      )}
      {copied && (
        <p role="status" className="text-caption text-muted-foreground">
          {t("pipelines.editor.copied")}
        </p>
      )}
    </section>
  );
}

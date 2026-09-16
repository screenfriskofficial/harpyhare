import { useCallback, useMemo, useState } from "react";
import type { usePipelineRun } from "@/hooks/usePipelineRun";
import type { Pipeline, PipelineInput, PreparedContext } from "@/lib/pipeline-types";
import {
  findPipeline,
  previewPipeline,
  semanticPipelineFingerprint,
  withPreparedContext,
} from "@/lib/pipelines";

type PipelineRun = ReturnType<typeof usePipelineRun>;

export interface PreparationDependency {
  /** The selected pipeline reads the chat context, so a prompt pipeline can stand in for a chat here. */
  readsChatContext: boolean;
  /** The prompt pipeline chosen to prepare that context; `undefined` when none is chosen or needed. */
  dependency: Pipeline | undefined;
  /**
   * What this screen already knows of the prepared context: a run of the
   * dependency on the current input, or its static preview when no model is
   * involved.
   */
  preparation: PreparedContext | undefined;
  /** The input the selected pipeline is previewed with. */
  effectiveInput: PipelineInput;
  /**
   * The input to execute with, after running the dependency when its result is
   * still unknown; `null` when that run failed or was cancelled.
   */
  resolveInput: () => Promise<PipelineInput | null>;
}

/**
 * A message pipeline that reads the chat context is tested the way the HUD
 * chains it on send: the chosen prompt pipeline runs first and its result is
 * the chat context of the test run. The result lives only as long as the
 * screen, and only for the input it was produced from.
 */
export function usePreparationDependency(
  pipelines: readonly Pipeline[],
  selected: Pipeline | undefined,
  preparationId: string,
  testInput: PipelineInput,
  preparationRun: PipelineRun,
): PreparationDependency {
  const [preparedFingerprint, setPreparedFingerprint] = useState<string | undefined>();
  const readsChatContext =
    selected?.kind === "message" &&
    selected.nodes.some((node) => node.kind === "chatContext" && node.enabled);
  const dependency = readsChatContext
    ? findPipeline(pipelines, preparationId, "prompt")
    : undefined;
  const dependencyFingerprint = useMemo(
    () => (dependency ? semanticPipelineFingerprint(dependency, testInput) : undefined),
    [dependency, testInput],
  );
  const dependencyPreview = useMemo(
    () => (dependency ? previewPipeline(dependency, testInput) : null),
    [dependency, testInput],
  );
  const { result: preparedResult, run: runPreparation } = preparationRun;
  const preparation = useMemo<PreparedContext | undefined>(() => {
    if (!dependency) return undefined;
    if (preparedResult && preparedFingerprint === dependencyFingerprint) return preparedResult;
    return dependencyPreview?.complete ? dependencyPreview : undefined;
  }, [dependency, preparedResult, preparedFingerprint, dependencyFingerprint, dependencyPreview]);
  const effectiveInput = useMemo(
    () =>
      dependency
        ? withPreparedContext(testInput, preparation, dependencyPreview?.keywordSources ?? [])
        : testInput,
    [dependency, testInput, preparation, dependencyPreview],
  );
  const resolveInput = useCallback(async (): Promise<PipelineInput | null> => {
    if (!dependency || preparation) return effectiveInput;
    setPreparedFingerprint(dependencyFingerprint);
    const result = await runPreparation(dependency, testInput);
    return result ? withPreparedContext(testInput, result) : null;
  }, [dependency, preparation, effectiveInput, dependencyFingerprint, runPreparation, testInput]);
  return { readsChatContext, dependency, preparation, effectiveInput, resolveInput };
}

import { cancelPipelineRun, runPipelineStep } from "@/ipc/commands";
import type { Pipeline, PipelineInput, PipelineNodeResult, PipelineResult } from "./pipeline-types";
import { executePipeline } from "./pipelines";

/** One native cancellation identity spans every model call in this execution. */
export async function runNativePipeline(
  pipeline: Pipeline,
  input: PipelineInput,
  signal: AbortSignal,
  onNode?: (node: PipelineNodeResult) => void,
): Promise<PipelineResult> {
  const runId = crypto.randomUUID();
  const cancel = () => {
    void cancelPipelineRun(runId).catch(() => undefined);
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    signal.throwIfAborted();
    return await executePipeline(pipeline, input, {
      signal,
      onNode,
      callModel: (request) =>
        runPipelineStep(
          runId,
          request.nodeId,
          request.messages,
          request.system,
          request.model,
          request.options,
        ),
    });
  } finally {
    signal.removeEventListener("abort", cancel);
    // Also releases a run whose last graph node was a deterministic transform.
    await cancelPipelineRun(runId).catch(() => undefined);
  }
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { errorMessage } from "@/lib/errors";
import { runNativePipeline } from "@/lib/pipeline-run";
import type {
  Pipeline,
  PipelineInput,
  PipelineNodeResult,
  PipelineResult,
} from "@/lib/pipeline-types";

/** One test run at a time on the launcher's «Схемы» screen: per-node progress, the final result and the failure text. */
export function usePipelineRun() {
  const current = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [resultsById, setResultsById] = useState<Record<string, PipelineNodeResult>>({});
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const results = useMemo(() => Object.values(resultsById), [resultsById]);
  const cancel = useCallback(() => {
    current.current?.abort();
  }, []);
  useEffect(() => cancel, [cancel]);
  const run = useCallback(async (pipeline: Pipeline, input: PipelineInput) => {
    // Guard before React renders the disabled button: a double activation must
    // not create another paid model request.
    if (current.current !== null) return null;
    const controller = new AbortController();
    current.current = controller;
    const live = () => current.current === controller && !controller.signal.aborted;
    setBusy(true);
    setError(null);
    setResult(null);
    setResultsById({});
    try {
      const value = await runNativePipeline(pipeline, input, controller.signal, (node) => {
        if (live()) setResultsById((previous) => ({ ...previous, [node.nodeId]: node }));
      });
      if (!live()) return null;
      setResult(value);
      return value;
    } catch (cause) {
      if (live()) setError(errorMessage(cause));
      return null;
    } finally {
      if (current.current === controller) {
        current.current = null;
        setBusy(false);
      }
    }
  }, []);
  return { busy, results, result, error, run, cancel };
}

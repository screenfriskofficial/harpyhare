import { useCallback, useEffect, useMemo, useState } from "react";
import { t } from "@/i18n";
import { loadPipelines, savePipelines } from "@/ipc/commands";
import { errorMessage } from "@/lib/errors";
import { onLoadError } from "@/lib/persist-errors";
import type { Pipeline, PipelineLibrary } from "@/lib/pipeline-types";
import {
  deserializePipelineLibrary,
  emptyPipelineLibrary,
  serializePipelineLibrary,
  upsertPipeline,
  removePipeline,
} from "@/lib/pipelines";
import { useDebouncedPersist } from "./useDebouncedPersist";

export interface PipelinesApi {
  library: PipelineLibrary;
  loaded: boolean;
  error: string | null;
  put: (pipeline: Pipeline) => void;
  remove: (id: string) => void;
  reload: () => void;
  flush: () => Promise<void>;
}

export function usePipelines(): PipelinesApi {
  const [library, setLibrary] = useState(emptyPipelineLibrary);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const { markLoaded, flush } = useDebouncedPersist(
    library,
    serializePipelineLibrary,
    savePipelines,
    "pipelines",
  );
  useEffect(() => {
    let live = true;
    void loadPipelines()
      .then((json) => {
        const restored = deserializePipelineLibrary(json);
        if (restored === null) throw new Error(t("pipelines.storage.invalid"));
        if (!live) return;
        setLibrary(restored);
        markLoaded(restored);
        setLoaded(true);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!live) return;
        setError(errorMessage(cause));
        onLoadError("pipelines")(cause);
      });
    return () => {
      live = false;
    };
  }, [generation, markLoaded]);
  const put = useCallback(
    (pipeline: Pipeline) => {
      if (loaded) setLibrary((value) => upsertPipeline(value, pipeline));
    },
    [loaded],
  );
  const remove = useCallback(
    (id: string) => {
      if (loaded) setLibrary((value) => removePipeline(value, id));
    },
    [loaded],
  );
  const reload = useCallback(() => {
    if (!loaded) setGeneration((value) => value + 1);
  }, [loaded]);
  return useMemo(
    () => ({ library, loaded, error, put, remove, reload, flush }),
    [library, loaded, error, put, remove, reload, flush],
  );
}

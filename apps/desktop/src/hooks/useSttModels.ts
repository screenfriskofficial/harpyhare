import { useQuery } from "@tanstack/react-query";
import type { SttModelInfo } from "@/ipc/bindings";
import { listOpenrouterSttModels } from "@/ipc/commands";
import { queryKeys } from "@/lib/query-client";

const CATALOG_STALE_MS = 60 * 60 * 1000;

export interface SttModelsState {
  models: SttModelInfo[];
  pending: boolean;
  failed: boolean;
  loaded: boolean;
  refresh: () => void;
}

/** One cached catalog for the HUD and settings; never put a key in query state. */
export function useSttModels(enabled: boolean): SttModelsState {
  const query = useQuery({
    queryKey: queryKeys.openrouterSttModels,
    queryFn: listOpenrouterSttModels,
    staleTime: CATALOG_STALE_MS,
    enabled,
  });
  return {
    models: query.data ?? [],
    pending: query.isFetching,
    failed: query.isError,
    loaded: query.data !== undefined,
    refresh: () => {
      void query.refetch();
    },
  };
}

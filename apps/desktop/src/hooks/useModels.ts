import { useQuery } from "@tanstack/react-query";
import { listModels } from "@/ipc/commands";
import { curatedModels, FALLBACK_MODELS, withLockedModels, type ModelInfo } from "@/lib/models";
import { queryKeys } from "@/lib/query-client";

const MODELS_STALE_MS = 60 * 60 * 1000;

/** Вшитый список проходит ту же обработку, что и сетевой: иначе разница всплывёт с первой правкой реестра. */
const CURATED_FALLBACK_MODELS = curatedModels(withLockedModels(FALLBACK_MODELS));

async function listModelsOrFallback(): Promise<ModelInfo[]> {
  const fetched = await listModels();
  return fetched.length > 0 ? curatedModels(withLockedModels(fetched)) : CURATED_FALLBACK_MODELS;
}

export interface ModelsState {
  models: ModelInfo[];
  /**
   * Показанный список ещё предварительный: живой каталог не пришёл. Отличать
   * это обязательно — вшитый список не знает моделей вендоров с динамическим
   * каталогом, поэтому выбранная модель выглядела бы «чужой» и попадала в
   * группу «Другие», а с приходом настоящего списка прыгала бы на своё место.
   * Ошибка загрузки — тоже «не пришёл», а не «пришёл вшитый».
   */
  pending: boolean;
}

export function useModels(): ModelsState {
  const { data, isPlaceholderData } = useQuery({
    queryKey: queryKeys.models,
    queryFn: listModelsOrFallback,
    staleTime: MODELS_STALE_MS,
    placeholderData: FALLBACK_MODELS,
  });
  return {
    models: data ?? CURATED_FALLBACK_MODELS,
    pending: isPlaceholderData || data === undefined,
  };
}

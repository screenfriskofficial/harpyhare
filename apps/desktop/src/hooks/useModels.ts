import { useQuery } from "@tanstack/react-query";
import type { CatalogFailure } from "@/ipc/bindings";
import { listModels } from "@/ipc/commands";
import { FALLBACK_MODELS, withLockedModels, type ModelInfo } from "@/lib/models";
import { queryKeys } from "@/lib/query-client";

const MODELS_STALE_MS = 60 * 60 * 1000;

interface ModelCatalogue {
  models: ModelInfo[];
  failures: CatalogFailure[];
}

const FALLBACK_CATALOGUE: ModelCatalogue = { models: FALLBACK_MODELS, failures: [] };

/**
 * Каждая модель, которую ключ может вызвать, — без курирования до «свежайшей в
 * семействе»: новая модель вендора появляется в списке сама, в тот же день.
 */
async function listModelsOrFallback(): Promise<ModelCatalogue> {
  const { models, failures } = await listModels();
  return { models: models.length > 0 ? withLockedModels(models) : FALLBACK_MODELS, failures };
}

export interface ModelsState {
  models: ModelInfo[];
  /**
   * Показанный список ещё предварительный: живой каталог не пришёл. Отличать
   * это обязательно — вшитый список знает не все модели живого каталога,
   * поэтому выбранная модель выглядела бы «чужой» и попадала в группу
   * «Другие», а с приходом настоящего списка прыгала бы на своё место.
   * Ошибка загрузки — тоже «не пришёл», а не «пришёл вшитый».
   */
  pending: boolean;
  /**
   * Вендоры, чей живой каталог не пришёл, и почему. Их модели в списке — это
   * прежние записи или вшитая таблица, и без этой подписи устаревший ключ
   * выглядел как «у приложения нет новых моделей».
   */
  failures: CatalogFailure[];
}

export function useModels(): ModelsState {
  const { data, isPlaceholderData } = useQuery({
    queryKey: queryKeys.models,
    queryFn: listModelsOrFallback,
    staleTime: MODELS_STALE_MS,
    placeholderData: FALLBACK_CATALOGUE,
  });
  return {
    models: data?.models ?? FALLBACK_MODELS,
    pending: isPlaceholderData || data === undefined,
    failures: data?.failures ?? [],
  };
}

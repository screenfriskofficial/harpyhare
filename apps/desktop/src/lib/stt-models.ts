import type { SearchableOption } from "@/components/SearchableSelect";
import type { SttModelsState } from "@/hooks/useSttModels";
import { t } from "@/i18n";

/** Keep a saved choice visible through loading, errors and catalog removals. */
export function sttModelOptions(catalog: SttModelsState, selectedId: string): SearchableOption[] {
  const options: SearchableOption[] = catalog.models.map((model) => ({
    value: model.id,
    label: model.name,
    keywords: ["OpenRouter"],
  }));
  if (!options.some((option) => option.value === selectedId)) {
    options.unshift({
      value: selectedId,
      label: selectedId,
      description: t(catalog.loaded ? "sttModels.unavailable" : "sttModels.saved"),
      disabled: catalog.loaded,
      keywords: ["OpenRouter"],
    });
  }
  return [
    ...options.filter((option) => option.value === selectedId),
    ...options.filter((option) => option.value !== selectedId),
  ];
}

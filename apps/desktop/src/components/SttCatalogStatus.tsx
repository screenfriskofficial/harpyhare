import { LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { SttModelsState } from "@/hooks/useSttModels";

export function SttCatalogStatus({ catalog }: { catalog: SttModelsState }) {
  const { t } = useTranslation();
  if (catalog.pending)
    return (
      <div
        role="status"
        className="flex shrink-0 items-center gap-2 px-3 py-2 text-caption text-muted-foreground"
      >
        <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
        {t("sttModels.loading")}
      </div>
    );
  if (catalog.failed)
    return (
      <div
        role="status"
        className="flex shrink-0 items-center justify-between gap-2 px-3 py-2 text-caption text-muted-foreground"
      >
        <span>{t("sttModels.failed")}</span>
        <Button variant="ghost" size="sm" onClick={catalog.refresh}>
          {t("common.retry")}
        </Button>
      </div>
    );
  return null;
}

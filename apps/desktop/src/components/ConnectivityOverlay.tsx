import { LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

interface ConnectivityOverlayProps {
  onRetry: () => void;
}

export function ConnectivityOverlay({ onRetry }: ConnectivityOverlayProps) {
  const { t } = useTranslation();
  return (
    <div className="absolute inset-0 z-50 grid place-items-center rounded-[var(--window-radius)] bg-background">
      <div className="flex max-w-xs flex-col items-center gap-3 px-6 text-center">
        <LoaderCircle
          className="size-6 animate-spin text-muted-foreground motion-reduce:animate-none"
          aria-hidden
        />
        <div className="flex flex-col gap-1">
          <span className="text-body font-medium text-foreground">
            {t("hud.connectivity.title")}
          </span>
          <span className="text-caption text-muted-foreground">{t("hud.connectivity.hint")}</span>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          {t("hud.connectivity.retry")}
        </Button>
      </div>
    </div>
  );
}

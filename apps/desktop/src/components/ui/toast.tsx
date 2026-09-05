import { AlertCircle, AlertTriangle, CheckCircle, Info, X } from "lucide-react";
import type { ComponentType, CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { Toaster as SonnerToaster } from "sonner";
import { cn } from "@/lib/utils";
import "sonner/dist/styles.css";

export const TOAST_DURATION_MS = 1500;
/** Ошибку надо успеть прочитать: заголовок, текст и кнопка закрытия. */
export const ERROR_TOAST_DURATION_MS = 6000;
/** Ширина контейнера sonner по умолчанию 356px — карточка уезжала влево. */
const TOAST_WIDTH = "20rem";

export type ToastVariant = "default" | "success" | "error" | "warning";

const TOAST_OFFSET_PX = 12;
const TOAST_GAP_PX = 8;
const VISIBLE_TOASTS = 3;

const VARIANT_FRAME: Record<ToastVariant, string> = {
  default: "border-border",
  success: "border-primary/40",
  error: "border-destructive/50",
  warning: "border-border",
};

const VARIANT_TITLE: Record<ToastVariant, string> = {
  default: "text-foreground",
  success: "text-foreground",
  error: "text-destructive",
  warning: "text-foreground",
};

const VARIANT_ICON: Record<ToastVariant, string> = {
  default: "text-muted-foreground",
  success: "text-primary",
  error: "text-destructive",
  warning: "text-muted-foreground",
};

const VARIANT_ICONS: Record<ToastVariant, ComponentType<{ className?: string }>> = {
  default: Info,
  success: CheckCircle,
  error: AlertCircle,
  warning: AlertTriangle,
};

export interface ToastAction {
  label: string;
  run: () => void;
}

export function ToastCard({
  title,
  message,
  variant,
  action,
  onDismiss,
}: {
  title?: string;
  message: string;
  variant: ToastVariant;
  action?: ToastAction;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const Icon = VARIANT_ICONS[variant];
  return (
    <div
      data-no-drag
      className={cn(
        "flex w-[min(20rem,calc(100vw-1.5rem))] items-start gap-2 rounded-lg border bg-card p-3 shadow-pop",
        VARIANT_FRAME[variant],
      )}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", VARIANT_ICON[variant])} aria-hidden />
      <div className="min-w-0 flex-1 space-y-0.5">
        {title !== undefined && title !== "" && (
          <p className={cn("text-caption font-medium", VARIANT_TITLE[variant])}>{title}</p>
        )}
        <p className="text-caption text-muted-foreground">{message}</p>
        {action && (
          <button
            type="button"
            onClick={() => {
              action.run();
              onDismiss();
            }}
            className="rounded-sm text-caption font-medium text-foreground underline-offset-2 transition-colors outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            {action.label}
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="rounded-sm p-1 text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
        aria-label={t("common.close")}
      >
        <X className="size-3" />
      </button>
    </div>
  );
}

export function Toaster() {
  return (
    <SonnerToaster
      theme="dark"
      position="top-center"
      duration={TOAST_DURATION_MS}
      visibleToasts={VISIBLE_TOASTS}
      offset={TOAST_OFFSET_PX}
      gap={TOAST_GAP_PX}
      style={{ "--width": TOAST_WIDTH } as CSSProperties}
      toastOptions={{ unstyled: true }}
    />
  );
}

import { createElement } from "react";
import { toast as sonnerToast } from "sonner";
import {
  ERROR_TOAST_DURATION_MS,
  ToastCard,
  TOAST_DURATION_MS,
  type ToastAction,
  type ToastVariant,
} from "@/components/ui/toast";
import { t, type TranslationKey } from "@/i18n";
import type { AppError, ErrorCode } from "@/lib/errors";

export { TOAST_DURATION_MS };

/**
 * Заголовок тоста по коду ошибки; `null` — код без тоста (сеть уходит в
 * оверлей, отмена молчит). Ключи словаря, а не текст: тост собирается в момент
 * показа и берёт текущий язык интерфейса.
 */
const ERROR_TOAST_TITLE: Record<ErrorCode, TranslationKey | null> = {
  network: null,
  cancelled: null,
  badApiKey: "errors.titles.badApiKey",
  badAccessCode: "errors.titles.badAccessCode",
  retryable: "errors.titles.retryable",
  api: "errors.titles.api",
  permission: "errors.titles.permission",
  silence: "errors.titles.silence",
  internal: "errors.titles.internal",
};

interface NotifyInput {
  title?: string;
  message: string;
  variant?: ToastVariant;
  durationMs?: number;
  action?: ToastAction;
  dedupeKey?: string;
}

export function errorToastContent(error: AppError): { title: string; message: string } | null {
  const titleKey = ERROR_TOAST_TITLE[error.code];
  if (titleKey === null) return null;
  return { title: t(titleKey), message: error.message };
}

export function notify(input: NotifyInput): void {
  const variant = input.variant ?? "default";
  sonnerToast.custom(
    (id) =>
      createElement(ToastCard, {
        title: input.title,
        message: input.message,
        variant,
        action: input.action,
        onDismiss: () => {
          sonnerToast.dismiss(id);
        },
      }),
    {
      // Один id на одинаковые сообщения: три чата стримят параллельно, и на
      // невалидном ключе они дают три копии подряд. Sonner при повторе того же
      // id обновляет карточку и перезапускает таймер вместо новой очереди.
      id: input.dedupeKey ?? `${variant}|${input.title ?? ""}|${input.message}`,
      duration:
        input.durationMs ?? (variant === "error" ? ERROR_TOAST_DURATION_MS : TOAST_DURATION_MS),
    },
  );
}

export function notifyAppError(error: AppError): void {
  const content = errorToastContent(error);
  if (content === null) return;
  notify({ ...content, variant: "error" });
}

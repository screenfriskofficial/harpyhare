import { createElement } from "react";
import { toast as sonnerToast } from "sonner";
import {
  ERROR_TOAST_DURATION_MS,
  ToastCard,
  TOAST_DURATION_MS,
  type ToastAction,
  type ToastVariant,
} from "@/components/ui/toast";
import type { AppError, ErrorCode } from "@/lib/errors";

export { TOAST_DURATION_MS };

/** Заголовки тостов HUD, которые не привязаны к коду ошибки. */
export const GENERIC_ERROR_TOAST_TITLE = "Ошибка";
export const CHATS_TOAST_TITLE = "Чаты";

const ERROR_TOAST_TITLE: Record<ErrorCode, string | null> = {
  network: null,
  cancelled: null,
  badApiKey: "Неверный ключ",
  badAccessCode: "Код доступа",
  retryable: "Сервис перегружен",
  api: "Ошибка API",
  permission: "Нет доступа",
  silence: "Речь не распознана",
  internal: "Ошибка",
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
  const title = ERROR_TOAST_TITLE[error.code];
  if (title === null) return null;
  return { title, message: error.message };
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

import { notify } from "@/lib/notify";

const COPY_ERROR_TITLE = "Ошибка";
const COPY_TEXT_ERROR_TEXT = "Не удалось скопировать текст в буфер обмена";

/**
 * Единственный путь текста в буфер из HUD: отказ `navigator.clipboard`
 * показывается тостом, а не уходит в unhandled rejection. Возвращает, удалось ли.
 */
export async function copyTextReportingError(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    notify({ variant: "error", title: COPY_ERROR_TITLE, message: COPY_TEXT_ERROR_TEXT });
    return false;
  }
}

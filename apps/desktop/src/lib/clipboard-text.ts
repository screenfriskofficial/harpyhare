import { t } from "@/i18n";
import { notifyError } from "@/lib/notify";

/**
 * Единственный путь текста в буфер из HUD: отказ `navigator.clipboard`
 * показывается тостом, а не уходит в unhandled rejection. Возвращает, удалось ли.
 */
export async function copyTextReportingError(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    notifyError(t("errors.copyTextFailed"));
    return false;
  }
}

import { t } from "@/i18n";
import { notify } from "@/lib/notify";

/** Что не удалось записать — подставляется в текст тоста в нужном падеже из словаря. */
export type PersistSubject = "chats" | "library" | "settings";

export const CHATS_SUBJECT: PersistSubject = "chats";
export const LIBRARY_SUBJECT: PersistSubject = "library";
export const SETTINGS_SUBJECT: PersistSubject = "settings";

export function onSaveError(subject: PersistSubject): (err: unknown) => void {
  return (err) => {
    notify({
      variant: "error",
      title: t("errors.saveFailedTitle"),
      message: t("errors.saveFailed", {
        subject: t(`errors.subjects.${subject}`),
        error: String(err),
      }),
    });
  };
}

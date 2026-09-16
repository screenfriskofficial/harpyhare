import { t } from "@/i18n";
import { errorMessage } from "@/lib/errors";
import { notify } from "@/lib/notify";

/** Что не удалось записать — подставляется в текст тоста в нужном падеже из словаря. */
export type PersistSubject = "chats" | "library" | "settings" | "pipelines";

export const CHATS_SUBJECT: PersistSubject = "chats";
export const LIBRARY_SUBJECT: PersistSubject = "library";
export const SETTINGS_SUBJECT: PersistSubject = "settings";

/**
 * The file could not be read. The store keeps working on an in-memory
 * placeholder and never writes over the file it failed to read — the user has
 * to know that, or a session of work quietly vanishes at the next restart.
 */
export function onLoadError(subject: PersistSubject): (err: unknown) => void {
  return (err) => {
    notify({
      variant: "error",
      title: t("errors.loadFailedTitle"),
      message: t("errors.loadFailed", {
        subject: t(`errors.subjects.${subject}`),
        error: errorMessage(err),
      }),
    });
  };
}

export function onSaveError(subject: PersistSubject): (err: unknown) => void {
  return (err) => {
    notify({
      variant: "error",
      title: t("errors.saveFailedTitle"),
      message: t("errors.saveFailed", {
        subject: t(`errors.subjects.${subject}`),
        error: errorMessage(err),
      }),
    });
  };
}

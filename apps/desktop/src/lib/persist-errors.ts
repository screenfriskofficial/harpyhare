import { notify } from "@/lib/notify";

const SAVE_ERROR_TITLE = "Не удалось сохранить";

export const CHATS_SUBJECT = "чаты";
export const LIBRARY_SUBJECT = "библиотеку контекстов";
export const SETTINGS_SUBJECT = "настройки";

export function onSaveError(subject: string): (err: unknown) => void {
  return (err) => {
    notify({
      variant: "error",
      title: SAVE_ERROR_TITLE,
      message: `Не удалось записать ${subject} на диск: ${String(err)}`,
    });
  };
}

import { useCallback, useEffect, useRef } from "react";
import { onSaveError, type PersistSubject } from "@/lib/persist-errors";
import { useLatestRef } from "./useLatestRef";

const PERSIST_DEBOUNCE_MS = 500;

export interface DebouncedPersist<T> {
  /**
   * Снимок, только что прочитанный с диска. Пока он не отмечен, ничего не
   * пишется; сам он тоже не пишется — иначе первое сохранение перезаписывало
   * бы файл тем, что из него прочитали, а при битом файле затирало бы его
   * дефолтом через полсекунды после старта.
   */
  markLoaded: (loaded: T) => void;
  /** Немедленная запись несохранённого хвоста; реджектит при сбое диска. */
  flush: () => Promise<void>;
}

/**
 * Один дебаунс-персист снимка на все хранилища (чаты, библиотека): таймер,
 * флаг «есть несохранённое», `flush` перед уходом из окна и запись на
 * размонтировании. Обе копии, что жили в хуках по отдельности, разошлись в
 * обработке ошибок — таймерный путь показывал тост, а `flush` на unmount давал
 * unhandled rejection. Здесь оба пути ведут в `onSaveError`.
 */
export function useDebouncedPersist<T>(
  value: T,
  serialize: (value: T) => string,
  save: (json: string) => Promise<unknown>,
  subject: PersistSubject,
): DebouncedPersist<T> {
  const latest = useLatestRef(value);
  const serializeRef = useLatestRef(serialize);
  const saveRef = useLatestRef(save);
  const persisted = useRef<{ value: T } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef(false);
  const inFlight = useRef<Promise<void> | null>(null);
  // How many `flush` callers await the current write. Their rejection is the
  // one they report themselves; the timer's toast would double it.
  const awaited = useRef(0);

  const write = useCallback((): Promise<void> => {
    clearTimeout(timer.current);
    timer.current = undefined;
    if (inFlight.current !== null) return inFlight.current;
    // A flush must wait for an already-started save, and newer snapshots must
    // never race an older write to disk. A failed snapshot stays dirty.
    inFlight.current = (async () => {
      while (pending.current && persisted.current !== null) {
        const snapshot = latest.current;
        pending.current = false;
        try {
          await saveRef.current(serializeRef.current(snapshot));
          persisted.current = { value: snapshot };
          if (latest.current !== snapshot) pending.current = true;
        } catch (error) {
          pending.current = true;
          throw error;
        }
      }
    })().finally(() => {
      inFlight.current = null;
    });
    return inFlight.current;
  }, [latest, saveRef, serializeRef]);

  const flush = useCallback((): Promise<void> => {
    const result = inFlight.current ?? (pending.current ? write() : null);
    if (result === null) return Promise.resolve();
    awaited.current += 1;
    return result.finally(() => {
      awaited.current -= 1;
    });
  }, [write]);

  const markLoaded = useCallback((loaded: T) => {
    persisted.current = { value: loaded };
  }, []);

  useEffect(() => {
    if (persisted.current === null || persisted.current.value === value) return;
    pending.current = true;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void write().catch((error: unknown) => {
        if (awaited.current === 0) onSaveError(subject)(error);
      });
    }, PERSIST_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer.current);
    };
  }, [value, write, subject]);

  useEffect(
    () => () => {
      void flush().catch(onSaveError(subject));
    },
    [flush, subject],
  );

  return { markLoaded, flush };
}

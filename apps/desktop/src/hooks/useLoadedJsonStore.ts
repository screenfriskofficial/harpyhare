import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { onLoadError, type PersistSubject } from "@/lib/persist-errors";
import { useDebouncedPersist } from "./useDebouncedPersist";
import { useLatestRef } from "./useLatestRef";

export interface LoadedJsonStoreInput<T> {
  load: () => Promise<string>;
  save: (json: string) => Promise<unknown>;
  /** `null` = nothing usable on disk yet (a missing or empty file): the store starts from `fallback`. */
  deserialize: (json: string) => T | null;
  serialize: (value: T) => string;
  subject: PersistSubject;
  /** The state until the file has been read. */
  initial: T;
  /** What the store works on when the file has nothing usable — or could not be read at all. */
  fallback: () => T;
  /** Runs with the value adopted from disk, in the same commit as its adoption. */
  onLoaded?: (value: T) => void;
}

export interface LoadedJsonStore<T> {
  value: T;
  setValue: Dispatch<SetStateAction<T>>;
  /** True once the file has been read; stays false after an unreadable one. */
  loaded: boolean;
  /** Immediate write of the unsaved tail; rejects on a disk failure. */
  flush: () => Promise<void>;
}

/**
 * One JSON document on disk behind a piece of state: read once on mount, then
 * every change is written with a debounce (`useDebouncedPersist`). The result
 * of the read is adopted only while the effect is still live (StrictMode
 * remounts), and an unreadable file is NEVER written over: the store keeps
 * working on the fallback in memory, nothing is marked loaded, so the debounced
 * persist never fires — the user gets a toast, and the file survives untouched
 * until a restart.
 */
export function useLoadedJsonStore<T>({
  load,
  save,
  deserialize,
  serialize,
  subject,
  initial,
  fallback,
  onLoaded,
}: LoadedJsonStoreInput<T>): LoadedJsonStore<T> {
  const [value, setValue] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);
  const { markLoaded, flush } = useDebouncedPersist(value, serialize, save, subject);
  // Read once; the callers' functions are looked up at that moment, not tracked.
  const loadRef = useLatestRef(load);
  const deserializeRef = useLatestRef(deserialize);
  const fallbackRef = useLatestRef(fallback);
  const onLoadedRef = useLatestRef(onLoaded);

  useEffect(() => {
    let live = true;
    void loadRef
      .current()
      .then((json) => {
        if (!live) return;
        const restored = deserializeRef.current(json) ?? fallbackRef.current();
        setValue(restored);
        markLoaded(restored);
        setLoaded(true);
        onLoadedRef.current?.(restored);
      })
      .catch((error: unknown) => {
        if (!live) return;
        setValue(fallbackRef.current());
        onLoadError(subject)(error);
      });
    return () => {
      live = false;
    };
  }, [markLoaded, subject, loadRef, deserializeRef, fallbackRef, onLoadedRef]);

  return { value, setValue, loaded, flush };
}

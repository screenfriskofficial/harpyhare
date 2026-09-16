/** A promise whose settlement the test controls. */
export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

export function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

/** One macrotask: Radix arms its outside-press listeners and returns focus on `setTimeout(0)`. */
export function tick(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** Narrows a fixture lookup; a missing fixture is a broken test, not a runtime branch. */
export function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected test fixture to exist");
  return value;
}

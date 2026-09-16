import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { reportSaveError } = vi.hoisted(() => ({ reportSaveError: vi.fn() }));
vi.mock("@/lib/persist-errors", () => ({ onSaveError: () => reportSaveError }));

import { useDebouncedPersist } from "./useDebouncedPersist";
import { deferred } from "@/test-utils/async";

function setup() {
  const save = vi.fn<(json: string) => Promise<void>>().mockResolvedValue();
  const initial = { text: "from disk" };
  const hook = renderHook(
    ({ value }) => useDebouncedPersist(value, JSON.stringify, save, "pipelines"),
    { initialProps: { value: initial } },
  );
  return { ...hook, save, initial };
}

beforeEach(() => {
  vi.useFakeTimers();
  reportSaveError.mockClear();
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("useDebouncedPersist durability", () => {
  it("never saves a placeholder or the snapshot just loaded from disk", async () => {
    const { result, rerender, save, unmount } = setup();
    const loaded = { text: "loaded library" };
    rerender({ value: loaded });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
      await result.current.flush();
    });
    expect(save).not.toHaveBeenCalled();
    act(() => {
      result.current.markLoaded(loaded);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
      await result.current.flush();
    });
    unmount();
    expect(save).not.toHaveBeenCalled();
  });

  it("debounces edits to the latest snapshot and does not save it twice", async () => {
    const { result, rerender, save, initial } = setup();
    act(() => {
      result.current.markLoaded(initial);
    });
    rerender({ value: { text: "first edit" } });
    await act(async () => vi.advanceTimersByTimeAsync(250));
    rerender({ value: { text: "latest edit" } });
    await act(async () => vi.advanceTimersByTimeAsync(499));
    expect(save).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(save).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ text: "latest edit" }));
    await act(async () => result.current.flush());
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("flush waits for a save already started by the timer", async () => {
    const { result, rerender, save, initial } = setup();
    const disk = deferred();
    save.mockReturnValueOnce(disk.promise);
    act(() => {
      result.current.markLoaded(initial);
    });
    rerender({ value: { text: "pending" } });
    await act(async () => vi.advanceTimersByTimeAsync(500));
    const finished = vi.fn<() => void>();
    let flush!: Promise<void>;
    act(() => {
      flush = result.current.flush().then(finished);
    });
    await act(async () => Promise.resolve());
    expect(finished).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => {
      disk.resolve();
      await flush;
    });
    expect(finished).toHaveBeenCalledTimes(1);
  });

  it("serializes writes and flush drains the newest snapshot arriving in flight", async () => {
    const { result, rerender, save, initial } = setup();
    const first = deferred();
    const latest = deferred();
    save.mockReturnValueOnce(first.promise).mockReturnValueOnce(latest.promise);
    act(() => {
      result.current.markLoaded(initial);
    });
    rerender({ value: { text: "first" } });
    await act(async () => vi.advanceTimersByTimeAsync(500));
    rerender({ value: { text: "intermediate" } });
    rerender({ value: { text: "latest" } });
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(save.mock.calls).toEqual([[JSON.stringify({ text: "first" })]]);
    const finished = vi.fn<() => void>();
    let flush!: Promise<void>;
    act(() => {
      flush = result.current.flush().then(finished);
    });
    await act(async () => {
      first.resolve();
      await Promise.resolve();
    });
    expect(save.mock.calls).toEqual([
      [JSON.stringify({ text: "first" })],
      [JSON.stringify({ text: "latest" })],
    ]);
    expect(finished).not.toHaveBeenCalled();
    await act(async () => {
      latest.resolve();
      await flush;
    });
    expect(finished).toHaveBeenCalledTimes(1);
    await act(async () => result.current.flush());
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("keeps a failed timer save dirty so explicit flush retries it", async () => {
    const { result, rerender, save, initial } = setup();
    const failure = new Error("disk full");
    save.mockRejectedValueOnce(failure);
    act(() => {
      result.current.markLoaded(initial);
    });
    rerender({ value: { text: "must survive" } });
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(reportSaveError).toHaveBeenCalledExactlyOnceWith(failure);
    await act(async () => result.current.flush());
    expect(save.mock.calls).toEqual([
      [JSON.stringify({ text: "must survive" })],
      [JSON.stringify({ text: "must survive" })],
    ]);
    await act(async () => result.current.flush());
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("reports a failed timer write once when a flush is already awaiting it", async () => {
    const { result, rerender, save, initial } = setup();
    const disk = deferred();
    const failure = new Error("EIO");
    save.mockReturnValueOnce(disk.promise);
    act(() => {
      result.current.markLoaded(initial);
    });
    rerender({ value: { text: "leaving" } });
    await act(async () => vi.advanceTimersByTimeAsync(500));
    let flush!: Promise<void>;
    act(() => {
      flush = result.current.flush();
    });
    const rejected = expect(flush).rejects.toBe(failure);
    await act(async () => {
      disk.reject(failure);
      await rejected;
    });
    // The caller of `flush` shows its own toast; a second one for the same write would be noise.
    expect(reportSaveError).not.toHaveBeenCalled();
  });

  it("rejects an awaited failed flush and retries the newest edit afterwards", async () => {
    const { result, rerender, save, initial } = setup();
    const disk = deferred();
    const failure = new Error("EIO");
    save.mockReturnValueOnce(disk.promise);
    act(() => {
      result.current.markLoaded(initial);
    });
    rerender({ value: { text: "first" } });
    let flush!: Promise<void>;
    act(() => {
      flush = result.current.flush();
    });
    const rejected = expect(flush).rejects.toBe(failure);
    rerender({ value: { text: "newer" } });
    await act(async () => {
      disk.reject(failure);
      await rejected;
    });
    await act(async () => result.current.flush());
    expect(save.mock.calls).toEqual([
      [JSON.stringify({ text: "first" })],
      [JSON.stringify({ text: "newer" })],
    ]);
  });
});

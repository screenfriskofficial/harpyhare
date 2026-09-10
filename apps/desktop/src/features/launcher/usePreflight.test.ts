import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PreflightProgress, PreflightReport } from "@/ipc/bindings";
import { DEFAULT_SETTINGS } from "@/ipc/types";

const mocks = vi.hoisted(() => ({ run: vi.fn(), cancel: vi.fn(), off: vi.fn() }));
let receive: ((event: PreflightProgress) => void) | undefined;
vi.mock("@/ipc/commands", () => ({ runPreflight: mocks.run, cancelPreflight: mocks.cancel }));
vi.mock("@/ipc/events", () => ({
  onEvent: (_name: string, callback: (event: PreflightProgress) => void) => {
    receive = callback;
    return mocks.off;
  },
}));
import { usePreflight } from "./usePreflight";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cancel.mockResolvedValue(undefined);
});

describe("preflight lifecycle", () => {
  it("does not ask to repeat a check when the model changes before the first run", () => {
    const { result, rerender } = renderHook(
      ({ model }) => usePreflight(DEFAULT_SETTINGS, model, true, () => Promise.resolve(true)),
      { initialProps: { model: "first" } },
    );
    rerender({ model: "second" });
    expect(result.current.stale).toBe(false);
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("never starts recording automatically, saves first, and rejects stale progress", async () => {
    const pending = deferred<PreflightReport>();
    mocks.run.mockReturnValue(pending.promise);
    const prepare = vi.fn().mockResolvedValue(true);
    const { result } = renderHook(() => usePreflight(DEFAULT_SETTINGS, "model", true, prepare));
    expect(mocks.run).not.toHaveBeenCalled();
    act(() => {
      void result.current.run();
    });
    await waitFor(() => {
      expect(mocks.run).toHaveBeenCalledTimes(1);
    });
    const id = mocks.run.mock.calls[0]?.[0] as string;
    expect(prepare).toHaveBeenCalledTimes(1);
    act(() => receive?.({ runId: "older", phase: "recording", remainingMs: 5000, levels: [] }));
    expect(result.current.progress?.phase).toBe("preparing");
    act(() => receive?.({ runId: id, phase: "recording", remainingMs: 5000, levels: [] }));
    expect(result.current.progress?.phase).toBe("recording");
    await act(async () => {
      pending.resolve({ runId: id, checks: [] });
      await pending.promise;
    });
    expect(result.current.busy).toBe(false);
    expect(result.current.report?.runId).toBe(id);
  });

  it("cancellation during saving prevents a provider request", async () => {
    const saved = deferred<boolean>();
    const { result } = renderHook(() =>
      usePreflight(DEFAULT_SETTINGS, "model", true, () => saved.promise),
    );
    act(() => {
      void result.current.run();
    });
    await act(() => result.current.cancel());
    await act(async () => {
      saved.resolve(true);
      await saved.promise;
    });
    expect(mocks.run).not.toHaveBeenCalled();
    expect(result.current.error).toBe("cancelled");
    expect(result.current.busy).toBe(false);
  });

  it("changing credentials cancels the run and cannot publish its old success", async () => {
    const pending = deferred<PreflightReport>();
    mocks.run.mockReturnValue(pending.promise);
    const { result, rerender } = renderHook(
      ({ settings }) => usePreflight(settings, "model", true, () => Promise.resolve(true)),
      { initialProps: { settings: DEFAULT_SETTINGS } },
    );
    act(() => {
      void result.current.run();
    });
    await waitFor(() => {
      expect(mocks.run).toHaveBeenCalledTimes(1);
    });
    const id = mocks.run.mock.calls[0]?.[0] as string;
    rerender({ settings: { ...DEFAULT_SETTINGS, openai_api_key: "changed" } });
    expect(mocks.cancel).toHaveBeenCalledWith(id);
    expect(result.current.busy).toBe(true);
    await act(async () => {
      pending.resolve({ runId: id, checks: [] });
      await pending.promise;
    });
    expect(result.current.report).toBeNull();
    expect(result.current.stale).toBe(true);
    expect(result.current.busy).toBe(false);
  });

  it("unmount cancels native work and removes its listener", async () => {
    mocks.run.mockReturnValue(new Promise(() => undefined));
    const { result, unmount } = renderHook(() =>
      usePreflight(DEFAULT_SETTINGS, "model", true, () => Promise.resolve(true)),
    );
    act(() => {
      void result.current.run();
    });
    await waitFor(() => {
      expect(mocks.run).toHaveBeenCalledTimes(1);
    });
    unmount();
    expect(mocks.cancel).toHaveBeenCalledWith(mocks.run.mock.calls[0]?.[0]);
    expect(mocks.off).toHaveBeenCalledTimes(1);
  });
});

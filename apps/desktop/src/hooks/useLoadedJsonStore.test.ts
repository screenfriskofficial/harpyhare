import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { reportLoadError, reportSaveError } = vi.hoisted(() => ({
  reportLoadError: vi.fn(),
  reportSaveError: vi.fn(),
}));
vi.mock("@/lib/persist-errors", () => ({
  onLoadError: () => reportLoadError,
  onSaveError: () => reportSaveError,
}));

import { useLoadedJsonStore } from "./useLoadedJsonStore";

interface Doc {
  text: string;
}

function setup(load: () => Promise<string>) {
  const save = vi.fn<(json: string) => Promise<void>>().mockResolvedValue();
  const onLoaded = vi.fn();
  const hook = renderHook(() =>
    useLoadedJsonStore<Doc>({
      load,
      save,
      deserialize: (json) => (json === "" ? null : { text: json }),
      serialize: (doc) => doc.text,
      subject: "library",
      initial: { text: "placeholder" },
      fallback: () => ({ text: "fresh" }),
      onLoaded,
    }),
  );
  return { ...hook, save, onLoaded };
}

beforeEach(() => {
  reportLoadError.mockClear();
  reportSaveError.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useLoadedJsonStore", () => {
  it("принимает прочитанное с диска и не пишет его тут же обратно", async () => {
    const { result, save, onLoaded } = setup(() => Promise.resolve("from disk"));
    expect(result.current.value).toEqual({ text: "placeholder" });
    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
    });
    expect(result.current.value).toEqual({ text: "from disk" });
    expect(onLoaded).toHaveBeenCalledWith({ text: "from disk" });
    await act(() => result.current.flush());
    expect(save).not.toHaveBeenCalled();
  });

  it("пустой файл — это старт с фолбэка, и правки поверх него уже пишутся", async () => {
    vi.useFakeTimers();
    const { result, save } = setup(() => Promise.resolve(""));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.loaded).toBe(true);
    expect(result.current.value).toEqual({ text: "fresh" });
    act(() => {
      result.current.setValue({ text: "edited" });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(save).toHaveBeenCalledWith("edited");
  });

  it("нечитаемый файл: тост, фолбэк в памяти и ни одной записи поверх файла", async () => {
    vi.useFakeTimers();
    const { result, save } = setup(() => Promise.reject(new Error("EACCES")));
    await act(async () => {
      await Promise.resolve();
    });
    expect(reportLoadError).toHaveBeenCalledTimes(1);
    expect(result.current.loaded).toBe(false);
    expect(result.current.value).toEqual({ text: "fresh" });
    act(() => {
      result.current.setValue({ text: "edited" });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    await act(() => result.current.flush());
    expect(save).not.toHaveBeenCalled();
  });
});

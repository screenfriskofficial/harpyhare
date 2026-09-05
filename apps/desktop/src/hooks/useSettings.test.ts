import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type Settings } from "@/ipc/types";

const getSettings = vi.fn(() => Promise.resolve(DEFAULT_SETTINGS));
const setSettings = vi.fn((s: Settings) => Promise.resolve(s));
const applyOpacity = vi.fn<(...a: unknown[]) => void>();

vi.mock("@/ipc/commands", () => ({
  getSettings: () => getSettings(),
  setSettings: (s: Settings) => setSettings(s),
}));
const notify = vi.fn<(...a: unknown[]) => void>();
vi.mock("@/lib/notify", () => ({
  notify: (...a: unknown[]) => {
    notify(...a);
  },
}));
vi.mock("@/lib/window-controls", async (orig) => {
  const real = await orig<typeof import("@/lib/window-controls")>();
  return {
    ...real,
    applyOpacity: (...a: unknown[]) => {
      applyOpacity(...a);
    },
  };
});

import { useSettings } from "./useSettings";

beforeEach(() => {
  getSettings.mockReset();
  setSettings.mockReset();
  setSettings.mockImplementation((s: Settings) => Promise.resolve(s));
  applyOpacity.mockClear();
  notify.mockClear();
});

describe("useSettings", () => {
  it("грузит настройки и применяет прозрачность", async () => {
    getSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, window_opacity: 0.6 });
    const { result } = renderHook(() => useSettings());
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.settings.window_opacity).toBe(0.6);
    expect(applyOpacity).toHaveBeenCalledWith(document.documentElement, 0.6);
  });

  it("save принимает настройки, применённые Rust'ом, без второго чтения", async () => {
    getSettings.mockResolvedValue(DEFAULT_SETTINGS);
    const { result } = renderHook(() => useSettings());
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    getSettings.mockClear();
    await act(async () => {
      await result.current.save({ ...DEFAULT_SETTINGS, window_opacity: 0.4 });
    });
    expect(setSettings).toHaveBeenCalled();
    expect(getSettings).not.toHaveBeenCalled();
    expect(result.current.settings.window_opacity).toBe(0.4);
  });

  it("bumpWindowSize шагает ширину и персистит с дебаунсом", async () => {
    vi.useFakeTimers();
    getSettings.mockResolvedValue(DEFAULT_SETTINGS);
    const { result } = renderHook(() => useSettings());
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    setSettings.mockClear();
    act(() => {
      result.current.bumpWindowSize("width", 1);
    });
    expect(result.current.settings.window_width).toBe(980);
    expect(result.current.settings.window_height).toBe(680);
    expect(setSettings).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(setSettings).toHaveBeenCalledTimes(1);
    expect(setSettings.mock.calls[0]?.[0]?.window_width).toBe(
      DEFAULT_SETTINGS.window_width + DEFAULT_SETTINGS.resize_step,
    );
    vi.useRealTimers();
  });

  it("bumpWindowSize клампит по минимуму ширины", async () => {
    getSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, window_width: 300 });
    const { result } = renderHook(() => useSettings());
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    act(() => {
      result.current.bumpWindowSize("width", -1);
    });
    expect(result.current.settings.window_width).toBe(300);
  });

  it("bumpWindowSize шагает на resize_step, а не move_step", async () => {
    getSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, move_step: 20, resize_step: 50 });
    const { result } = renderHook(() => useSettings());
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    act(() => {
      result.current.bumpWindowSize("width", 1);
    });
    expect(result.current.settings.window_width).toBe(1010);
  });

  it("applyNativeWindowSize округляет, клампит и персистит с дебаунсом", async () => {
    vi.useFakeTimers();
    getSettings.mockResolvedValue(DEFAULT_SETTINGS);
    const { result } = renderHook(() => useSettings());
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    setSettings.mockClear();
    act(() => {
      result.current.applyNativeWindowSize(1000.4, 5000);
    });
    expect(result.current.settings.window_width).toBe(1000);
    expect(result.current.settings.window_height).toBe(1100);
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(setSettings).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("applyNativeWindowSize игнорирует совпадающий размер", async () => {
    vi.useFakeTimers();
    getSettings.mockResolvedValue(DEFAULT_SETTINGS);
    const { result } = renderHook(() => useSettings());
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    setSettings.mockClear();
    act(() => {
      result.current.applyNativeWindowSize(960, 680);
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(setSettings).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("bumpOpacity меняет прозрачность, применяет и персистит с дебаунсом", async () => {
    vi.useFakeTimers();
    getSettings.mockResolvedValue(DEFAULT_SETTINGS);
    const { result } = renderHook(() => useSettings());
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    setSettings.mockClear();
    applyOpacity.mockClear();
    act(() => {
      result.current.bumpOpacity(-1);
    });
    expect(result.current.settings.window_opacity).toBeCloseTo(0.8);
    expect(applyOpacity).toHaveBeenCalledWith(document.documentElement, 0.8);
    expect(setSettings).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(setSettings).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("на размонтировании сбрасывает несохранённый размер на диск", async () => {
    vi.useFakeTimers();
    getSettings.mockResolvedValue(DEFAULT_SETTINGS);
    const { result, unmount } = renderHook(() => useSettings());
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    setSettings.mockClear();
    act(() => {
      result.current.bumpWindowSize("width", 1);
    });
    expect(setSettings).not.toHaveBeenCalled();
    unmount();
    expect(setSettings).toHaveBeenCalledTimes(1);
    expect(setSettings.mock.calls[0]?.[0]?.window_width).toBe(
      DEFAULT_SETTINGS.window_width + DEFAULT_SETTINGS.resize_step,
    );
    vi.useRealTimers();
  });

  it("bumpWindowSize и bumpOpacity персистят одним вызовом с обоими изменениями", async () => {
    vi.useFakeTimers();
    getSettings.mockResolvedValue(DEFAULT_SETTINGS);
    const { result } = renderHook(() => useSettings());
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    setSettings.mockClear();
    act(() => {
      result.current.bumpWindowSize("width", 1);
    });
    act(() => {
      result.current.bumpOpacity(-1);
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(setSettings).toHaveBeenCalledTimes(1);
    expect(setSettings.mock.calls[0]?.[0]?.window_width).toBe(
      DEFAULT_SETTINGS.window_width + DEFAULT_SETTINGS.resize_step,
    );
    expect(setSettings.mock.calls[0]?.[0]?.window_opacity).toBeCloseTo(0.8);
    vi.useRealTimers();
  });

  it("явный save отменяет отложенный persist, чтобы не затереть свежие поля", async () => {
    vi.useFakeTimers();
    getSettings.mockResolvedValue(DEFAULT_SETTINGS);
    const { result } = renderHook(() => useSettings());
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    setSettings.mockClear();
    act(() => {
      result.current.bumpOpacity(-1);
    });
    await act(async () => {
      await result.current.save({ ...result.current.settings, skipped_version: "9.9.9" });
    });
    expect(setSettings).toHaveBeenCalledTimes(1);
    expect(setSettings.mock.calls[0]?.[0]?.skipped_version).toBe("9.9.9");
    expect(setSettings.mock.calls[0]?.[0]?.window_opacity).toBeCloseTo(0.8);
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(setSettings).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("явный save со снимком, снятым до хоткея, не теряет отложенное изменение", async () => {
    vi.useFakeTimers();
    getSettings.mockResolvedValue(DEFAULT_SETTINGS);
    const { result } = renderHook(() => useSettings());
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    setSettings.mockClear();
    const staleSnapshot = { ...result.current.settings };
    act(() => {
      result.current.bumpOpacity(-1);
    });
    await act(async () => {
      await result.current.save({ ...staleSnapshot, skipped_version: "9.9.9" });
    });
    expect(setSettings).toHaveBeenCalledTimes(1);
    expect(setSettings.mock.calls[0]?.[0]?.skipped_version).toBe("9.9.9");
    expect(setSettings.mock.calls[0]?.[0]?.window_opacity).toBeCloseTo(0.8);
    vi.useRealTimers();
  });

  it("хоткей, нажатый пока save в полёте, не откатывается ответом Rust и уходит на диск", async () => {
    vi.useFakeTimers();
    getSettings.mockResolvedValue(DEFAULT_SETTINGS);
    const { result } = renderHook(() => useSettings());
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    setSettings.mockReset();
    let resolveSave: (s: Settings) => void = () => undefined;
    setSettings.mockImplementationOnce(
      (s: Settings) =>
        new Promise<Settings>((resolve) => {
          resolveSave = () => {
            resolve(s);
          };
        }),
    );
    setSettings.mockImplementation((s: Settings) => Promise.resolve(s));
    let saved: Promise<string | null> = Promise.resolve(null);
    act(() => {
      saved = result.current.save({ ...result.current.settings, skipped_version: "9.9.9" });
    });
    act(() => {
      result.current.bumpOpacity(-1);
    });
    expect(result.current.settings.window_opacity).toBeCloseTo(0.8);
    await act(async () => {
      resolveSave(DEFAULT_SETTINGS);
      await saved;
    });
    expect(result.current.settings.window_opacity).toBeCloseTo(0.8);
    expect(result.current.settings.skipped_version).toBe("9.9.9");
    expect(applyOpacity).toHaveBeenLastCalledWith(document.documentElement, expect.closeTo(0.8, 5));
    await act(async () => {
      vi.advanceTimersByTime(400);
      await Promise.resolve();
    });
    const last = setSettings.mock.calls[setSettings.mock.calls.length - 1]?.[0];
    expect(last?.window_opacity).toBeCloseTo(0.8);
    expect(last?.skipped_version).toBe("9.9.9");
    vi.useRealTimers();
  });

  it("сбой отложенного персиста показывает тост, а не молчит", async () => {
    vi.useFakeTimers();
    getSettings.mockResolvedValue(DEFAULT_SETTINGS);
    const { result } = renderHook(() => useSettings());
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    setSettings.mockRejectedValueOnce(new Error("диск полон"));
    act(() => {
      result.current.bumpOpacity(-1);
    });
    await act(async () => {
      vi.advanceTimersByTime(400);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "error",
        message: expect.stringContaining("диск полон") as string,
      }),
    );
    vi.useRealTimers();
  });
});

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const probeConnectivity = vi.fn<() => Promise<boolean>>();
vi.mock("@/ipc/commands", () => ({
  probeConnectivity: () => probeConnectivity(),
}));

import { useConnectivity } from "./useConnectivity";

function setOnLine(value: boolean): void {
  Object.defineProperty(navigator, "onLine", { value, configurable: true });
}

beforeEach(() => {
  probeConnectivity.mockReset();
  setOnLine(true);
});

describe("useConnectivity", () => {
  it("онлайн + успешная проба → offline=false", async () => {
    probeConnectivity.mockResolvedValue(true);
    const { result } = renderHook(() => useConnectivity());
    await waitFor(() => {
      expect(probeConnectivity).toHaveBeenCalled();
    });
    expect(result.current.offline).toBe(false);
  });

  it("navigator.onLine=false на старте → offline=true сразу", () => {
    setOnLine(false);
    probeConnectivity.mockResolvedValue(false);
    const { result } = renderHook(() => useConnectivity());
    expect(result.current.offline).toBe(true);
  });

  it("проба бросает → offline=true", async () => {
    probeConnectivity.mockRejectedValue(new Error("network"));
    const { result } = renderHook(() => useConnectivity());
    await waitFor(() => {
      expect(result.current.offline).toBe(true);
    });
  });

  it("reportNetworkError поднимает offline и сразу перепроверяет", async () => {
    probeConnectivity.mockResolvedValue(true);
    const { result } = renderHook(() => useConnectivity());
    await waitFor(() => {
      expect(result.current.offline).toBe(false);
    });
    const callsBefore = probeConnectivity.mock.calls.length;
    act(() => {
      result.current.reportNetworkError();
    });
    expect(result.current.offline).toBe(true);
    await waitFor(() => {
      expect(probeConnectivity.mock.calls.length).toBeGreaterThan(callsBefore);
    });
    await waitFor(() => {
      expect(result.current.offline).toBe(false);
    });
  });

  it("событие offline → offline=true", async () => {
    probeConnectivity.mockResolvedValue(true);
    const { result } = renderHook(() => useConnectivity());
    await waitFor(() => {
      expect(result.current.offline).toBe(false);
    });
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(result.current.offline).toBe(true);
  });

  it("событие online перепроверяет связь и снимает offline при успехе", async () => {
    probeConnectivity.mockResolvedValue(false);
    const { result } = renderHook(() => useConnectivity());
    await waitFor(() => {
      expect(result.current.offline).toBe(true);
    });
    probeConnectivity.mockResolvedValue(true);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(() => {
      expect(result.current.offline).toBe(false);
    });
  });

  it("retry перепроверяет и снимает offline при успехе", async () => {
    probeConnectivity.mockResolvedValue(false);
    const { result } = renderHook(() => useConnectivity());
    await waitFor(() => {
      expect(result.current.offline).toBe(true);
    });
    probeConnectivity.mockResolvedValue(true);
    act(() => {
      result.current.retry();
    });
    await waitFor(() => {
      expect(result.current.offline).toBe(false);
    });
  });

  it("поздний провал старой пробы не возвращает offline после успеха", async () => {
    const pending: ((value: boolean) => void)[] = [];
    probeConnectivity.mockImplementation(
      () =>
        new Promise((resolve) => {
          pending.push(resolve);
        }),
    );
    setOnLine(false);
    const { result } = renderHook(() => useConnectivity());
    expect(result.current.offline).toBe(true);
    await waitFor(() => {
      expect(pending.length).toBeGreaterThan(0);
    });
    const stale = [...pending];
    pending.length = 0;
    probeConnectivity.mockResolvedValue(true);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(() => {
      expect(result.current.offline).toBe(false);
    });
    act(() => {
      for (const resolve of stale) {
        resolve(false);
      }
    });
    expect(result.current.offline).toBe(false);
  });

  it("переход в offline запускает ровно одну немедленную пробу", async () => {
    probeConnectivity.mockResolvedValue(false);
    const { result } = renderHook(() => useConnectivity());
    await waitFor(() => {
      expect(result.current.offline).toBe(true);
    });
    await waitFor(() => {
      expect(probeConnectivity).toHaveBeenCalledTimes(2);
    });
  });

  it("старт в offline делает одну пробу, а не две", () => {
    setOnLine(false);
    probeConnectivity.mockResolvedValue(false);
    renderHook(() => useConnectivity());
    expect(probeConnectivity).toHaveBeenCalledTimes(1);
  });
});

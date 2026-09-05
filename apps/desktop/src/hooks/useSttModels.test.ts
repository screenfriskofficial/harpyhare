import { renderHook, waitFor, act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryWrapper } from "@/test/query-wrapper";
import type { SttModelInfo } from "@/ipc/bindings";

const fetchCatalog = vi.fn<() => Promise<SttModelInfo[]>>();
vi.mock("@/ipc/commands", () => ({ listOpenrouterSttModels: () => fetchCatalog() }));
import { useSttModels } from "./useSttModels";

afterEach(() => vi.resetAllMocks());

describe("useSttModels", () => {
  it("loads on demand and shares the catalog between consumers", async () => {
    const rows = [{ id: "vendor/model", name: "Model" }];
    fetchCatalog.mockResolvedValue(rows);
    const { result, rerender } = renderHook(
      ({ enabled }) => [useSttModels(enabled), useSttModels(enabled)],
      {
        initialProps: { enabled: false },
        wrapper: createQueryWrapper(),
      },
    );
    expect(fetchCatalog).not.toHaveBeenCalled();
    rerender({ enabled: true });
    await waitFor(() => {
      expect(result.current[0]?.loaded).toBe(true);
    });
    expect(result.current[1]?.models).toEqual(rows);
    expect(fetchCatalog).toHaveBeenCalledTimes(1);
  });

  it("keeps the cached catalog on refresh failure and supports retry", async () => {
    const rows = [{ id: "vendor/model", name: "Model" }];
    fetchCatalog
      .mockResolvedValueOnce(rows)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(rows);
    const { result } = renderHook(() => useSttModels(true), { wrapper: createQueryWrapper() });
    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
    });
    act(() => {
      result.current.refresh();
    });
    await waitFor(() => {
      expect(result.current.failed).toBe(true);
    });
    expect(result.current.models).toEqual(rows);
    act(() => {
      result.current.refresh();
    });
    await waitFor(() => {
      expect(result.current.failed).toBe(false);
    });
    expect(fetchCatalog).toHaveBeenCalledTimes(3);
  });
});

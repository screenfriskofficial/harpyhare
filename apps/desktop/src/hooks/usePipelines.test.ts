import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPipeline,
  deserializePipelineLibrary,
  serializePipelineLibrary,
} from "@/lib/pipelines";

const { load, save, report } = vi.hoisted(() => ({
  load: vi.fn<() => Promise<string>>(),
  save: vi.fn<(json: string) => Promise<void>>(),
  report: vi.fn(),
}));
vi.mock("@/ipc/commands", () => ({ loadPipelines: load, savePipelines: save }));
vi.mock("@/lib/persist-errors", () => ({ onLoadError: () => report, onSaveError: () => report }));

import { usePipelines } from "./usePipelines";

beforeEach(() => {
  load.mockReset().mockResolvedValue("");
  save.mockReset().mockResolvedValue();
  report.mockReset();
});
afterEach(cleanup);

describe("pipeline storage boundary", () => {
  it.each(["{broken", '{"version":999,"pipelines":[]}'])(
    "preserves malformed or newer files without autosaving: %s",
    async (json) => {
      load.mockResolvedValue(json);
      const { result, unmount } = renderHook(() => usePipelines());
      await waitFor(() => {
        expect(result.current.error).not.toBeNull();
      });
      // The localized text itself, not `Error: …` — the workspace prints it as is.
      expect(result.current.error).toBe(
        "Файл схем повреждён или создан более новой версией приложения. Исходный файл сохранён.",
      );
      expect(result.current.loaded).toBe(false);
      act(() => {
        result.current.put(createPipeline("prompt"));
      });
      await act(async () => result.current.flush());
      unmount();
      expect(save).not.toHaveBeenCalled();
    },
  );

  it("can reload after a read failure without rewriting the recovered snapshot", async () => {
    const pipeline = createPipeline("message");
    const json = serializePipelineLibrary({ version: 1, pipelines: [pipeline] });
    load.mockRejectedValueOnce(new Error("EIO")).mockResolvedValue(json);
    const { result } = renderHook(() => usePipelines());
    await waitFor(() => {
      expect(result.current.error).toBe("EIO");
    });
    act(() => {
      result.current.reload();
    });
    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
    });
    expect(result.current.error).toBeNull();
    expect(result.current.library.pipelines).toEqual([pipeline]);
    await act(async () => result.current.flush());
    expect(save).not.toHaveBeenCalled();
  });

  it("flushes an incomplete editable draft and restores its identity and nodes", async () => {
    const { result } = renderHook(() => usePipelines());
    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
    });
    const pipeline = createPipeline("prompt", "Interview preparation");
    act(() => {
      result.current.put(pipeline);
    });
    await act(async () => result.current.flush());
    expect(save).toHaveBeenCalledTimes(1);
    const stored = deserializePipelineLibrary(save.mock.calls[0]?.[0] ?? "");
    expect(stored?.pipelines).toEqual([pipeline]);
  });
});

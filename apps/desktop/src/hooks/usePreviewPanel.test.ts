import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PreviewContent } from "@/lib/html-blocks";
import { usePreviewPanel } from "./usePreviewPanel";

const A: PreviewContent = { kind: "html", code: "<a></a>", html: "<a></a>" };
const B: PreviewContent = { kind: "html", code: "<b></b>", html: "<b></b>" };
const VIEW = { x: 10, y: 20, zoom: 0.8 };

describe("usePreviewPanel", () => {
  it("повторный клик по тому же блоку закрывает панель, по другому — подменяет содержимое", () => {
    const { result } = renderHook(() => usePreviewPanel());
    act(() => {
      result.current.togglePreview(A);
    });
    expect(result.current.previewOpen).toBe(true);
    act(() => {
      result.current.togglePreview(B);
    });
    expect(result.current.previewContent).toBe(B);
    expect(result.current.previewOpen).toBe(true);
    act(() => {
      result.current.togglePreview(B);
    });
    expect(result.current.previewOpen).toBe(false);
  });

  it("вьюпорт схемы переживает закрытие и повторное открытие того же блока, но сбрасывается на другом", () => {
    const { result } = renderHook(() => usePreviewPanel());
    act(() => {
      result.current.openPreview(A);
    });
    result.current.viewportMemory.current = VIEW;
    act(() => {
      result.current.closePreview();
    });
    act(() => {
      result.current.togglePreview(A);
    });
    expect(result.current.viewportMemory.current).toEqual(VIEW);
    act(() => {
      result.current.openPreview(A);
    });
    expect(result.current.viewportMemory.current).toEqual(VIEW);
    act(() => {
      result.current.openPreview(B);
    });
    expect(result.current.viewportMemory.current).toBeNull();
  });
});

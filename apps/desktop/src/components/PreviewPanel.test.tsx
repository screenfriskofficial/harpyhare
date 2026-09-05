import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const setPreviewHtml = vi.fn<(_h: string) => Promise<void>>(() => Promise.resolve());
vi.mock("@/ipc/commands", () => ({
  setPreviewHtml: (h: string) => setPreviewHtml(h),
}));
vi.mock("@/ipc/preview", () => ({
  previewUrl: (version: number) => `preview://localhost/?v=${version}`,
}));

import { PreviewPanel } from "./PreviewPanel";

beforeEach(() => {
  setPreviewHtml.mockClear();
});

describe("PreviewPanel", () => {
  it("шлёт html в set_preview_html и грузит iframe с нонсом в src", async () => {
    const { container } = render(<PreviewPanel html="<p>hi</p>" onClose={() => undefined} />);
    await waitFor(() => {
      expect(setPreviewHtml).toHaveBeenCalledWith(expect.stringContaining("<p>hi</p>"));
      expect(setPreviewHtml).toHaveBeenCalledWith(
        expect.stringContaining('id="harpyhare-preview-cursor"'),
      );
    });
    await waitFor(() => {
      const src = container.querySelector("iframe")?.getAttribute("src");
      expect(src).toMatch(/^preview:\/\/localhost\/\?v=\d+$/);
    });
  });

  it("нонс растёт при смене html (cache-bust)", async () => {
    const { container, rerender } = render(
      <PreviewPanel html="<p>a</p>" onClose={() => undefined} />,
    );
    await waitFor(() => {
      expect(container.querySelector("iframe")?.getAttribute("src")).toBe(
        "preview://localhost/?v=1",
      );
    });
    rerender(<PreviewPanel html="<p>b</p>" onClose={() => undefined} />);
    await waitFor(() => {
      expect(container.querySelector("iframe")?.getAttribute("src")).toBe(
        "preview://localhost/?v=2",
      );
    });
  });

  it("пустой html — заглушка, без iframe", () => {
    const { container, getByText } = render(<PreviewPanel html="" onClose={() => undefined} />);
    expect(container.querySelector("iframe")).toBeNull();
    getByText("Нет содержимого");
  });
});

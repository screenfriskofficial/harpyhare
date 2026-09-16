import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PreviewContent } from "@/lib/html-blocks";

const setPreviewHtml = vi.fn<(_h: string) => Promise<void>>(() => Promise.resolve());
vi.mock("@/ipc/commands", () => ({
  setPreviewHtml: (h: string) => setPreviewHtml(h),
}));
vi.mock("@/ipc/preview", () => ({
  previewUrl: (version: number) => `preview://localhost/?v=${version}`,
}));
vi.mock("@/features/system-design/SystemDesignDiagramLoader", () => ({
  SystemDesignDiagramLoader: ({ design }: { design: { TITLE: string } }) => (
    <div data-testid="diagram">{design.TITLE}</div>
  ),
}));

import { PreviewPanel } from "./PreviewPanel";

const html = (code: string): PreviewContent => ({ kind: "html", code, html: code });
const DESIGN = {
  version: 1 as const,
  TITLE: "Feed v2",
  NODES: [{ id: "api", col: 0, kind: "service" as const, title: "API" }],
  EDGES: [],
  GROUPS: [],
};
const designContent = (): PreviewContent => ({ kind: "system-design", code: "{}", design: DESIGN });
const SIZING = {
  width: 570,
  windowWidth: 960,
  resizeStep: 20,
  onResize: () => undefined,
  viewportMemory: { current: null },
};

beforeEach(() => {
  setPreviewHtml.mockClear();
});
afterEach(cleanup);

describe("PreviewPanel", () => {
  it("шлёт html в set_preview_html и грузит iframe с нонсом в src", async () => {
    const { container } = render(
      <PreviewPanel {...SIZING} content={html("<p>hi</p>")} onClose={() => undefined} />,
    );
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
      <PreviewPanel {...SIZING} content={html("<p>a</p>")} onClose={() => undefined} />,
    );
    await waitFor(() => {
      expect(container.querySelector("iframe")?.getAttribute("src")).toBe(
        "preview://localhost/?v=1",
      );
    });
    rerender(<PreviewPanel {...SIZING} content={html("<p>b</p>")} onClose={() => undefined} />);
    await waitFor(() => {
      expect(container.querySelector("iframe")?.getAttribute("src")).toBe(
        "preview://localhost/?v=2",
      );
    });
  });

  it("схему рисует сама, без iframe и без отправки в Rust, с названием в шапке", () => {
    const { container, getByTestId, getAllByText } = render(
      <PreviewPanel {...SIZING} content={designContent()} onClose={() => undefined} />,
    );
    expect(container.querySelector("iframe")).toBeNull();
    expect(setPreviewHtml).not.toHaveBeenCalled();
    expect(getByTestId("diagram").textContent).toBe("Feed v2");
    expect(getAllByText("Feed v2").length).toBeGreaterThan(1);
  });
});

describe("PreviewPanel splitter", () => {
  function renderSplitter() {
    const onResize = vi.fn<(width: number) => void>();
    render(
      <PreviewPanel
        {...SIZING}
        onResize={onResize}
        content={designContent()}
        onClose={() => undefined}
      />,
    );
    return { onResize, handle: screen.getByRole("separator", { name: "Ширина превью" }) };
  }

  // Frames run only when the test says so — as in a browser, never inside the request.
  let frames: FrameRequestCallback[] = [];
  const flushFrames = () => {
    const pending = frames;
    frames = [];
    pending.forEach((callback) => {
      callback(0);
    });
  };
  // Assigned and restored by hand: `vi.unstubAllGlobals()` would also drop the
  // jsdom stubs `test-setup.ts` installs for the rest of this file.
  const original = {
    request: globalThis.requestAnimationFrame,
    cancel: globalThis.cancelAnimationFrame,
  };
  beforeEach(() => {
    frames = [];
    globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    };
    globalThis.cancelAnimationFrame = () => undefined;
  });
  afterEach(() => {
    globalThis.requestAnimationFrame = original.request;
    globalThis.cancelAnimationFrame = original.cancel;
  });

  it("сообщает ширину и её границы для этого окна", () => {
    const { handle } = renderSplitter();
    expect(handle.getAttribute("aria-valuenow")).toBe("570");
    expect(handle.getAttribute("aria-valuemin")).toBe("260");
    expect(handle.getAttribute("aria-valuemax")).toBe(String(960 - 24 + 570 - (300 - 24)));
  });

  it("тянуть границу влево — панель шире на пройденное расстояние, после отпускания движение не считается", () => {
    const { handle, onResize } = renderSplitter();
    fireEvent.mouseDown(handle, { button: 0, clientX: 400 });
    expect(document.querySelector(".fixed.inset-0")).not.toBeNull();
    fireEvent.mouseMove(document, { clientX: 360 });
    fireEvent.mouseMove(document, { clientX: 340 });
    expect(onResize).not.toHaveBeenCalled();
    flushFrames();
    // Two moves inside one frame apply once, with the latest position.
    expect(onResize).toHaveBeenCalledTimes(1);
    expect(onResize).toHaveBeenLastCalledWith(630);
    fireEvent.mouseMove(document, { clientX: 450 });
    flushFrames();
    expect(onResize).toHaveBeenLastCalledWith(520);
    fireEvent.mouseUp(document);
    expect(onResize).toHaveBeenLastCalledWith(520);
    expect(document.querySelector(".fixed.inset-0")).toBeNull();
    onResize.mockClear();
    fireEvent.mouseMove(document, { clientX: 100 });
    flushFrames();
    expect(onResize).not.toHaveBeenCalled();
  });

  it("правая кнопка границу не тянет", () => {
    const { handle, onResize } = renderSplitter();
    fireEvent.mouseDown(handle, { button: 2, clientX: 400 });
    fireEvent.mouseMove(document, { clientX: 300 });
    expect(onResize).not.toHaveBeenCalled();
  });

  it("стрелки на границе шагают на шаг размера окна: влево шире, вправо уже", () => {
    const { handle, onResize } = renderSplitter();
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(onResize).toHaveBeenLastCalledWith(590);
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(onResize).toHaveBeenLastCalledWith(550);
    onResize.mockClear();
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    expect(onResize).not.toHaveBeenCalled();
  });
});

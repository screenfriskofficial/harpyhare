import { createContext, runInContext } from "node:vm";
import { afterEach, describe, expect, it } from "vitest";
import { withDiagramViewport } from "./diagram-viewport";
import { systemDesignHtml } from "./system-design";

const DATA = {
  version: 1,
  TITLE: "Large diagram",
  NODES: Array.from({ length: 8 }, (_, col) => ({
    id: `n${col}`,
    col,
    kind: "service",
    title: `Service ${col}`,
  })),
  EDGES: [],
};

afterEach(() => {
  document.body.replaceChildren();
});

function mount() {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) throw new Error("Missing frame");
  const html = systemDesignHtml(JSON.stringify(DATA));
  if (!html) throw new Error("Missing diagram");
  // innerHTML creates inert scripts; execute each once below with the observer stub.
  doc.documentElement.innerHTML = html;
  const wrap = doc.getElementById("wrap");
  if (!wrap) throw new Error("Missing viewport");
  let width = 570,
    height = 460,
    capture: number | undefined;
  Object.defineProperties(wrap, {
    clientWidth: { get: () => width },
    clientHeight: { get: () => height },
  });
  wrap.setPointerCapture = (id) => {
    capture = id;
  };
  wrap.hasPointerCapture = (id) => capture === id;
  wrap.releasePointerCapture = () => {
    capture = undefined;
  };
  let onResize: () => void = () => undefined;
  const context = createContext({
    document: doc,
    window: win,
    ResizeObserver: class {
      constructor(callback: () => void) {
        onResize = callback;
      }
      observe() {
        return undefined;
      }
    },
  });
  for (const script of doc.querySelectorAll("script")) {
    runInContext(script.textContent ?? "", context, { timeout: 1000 });
  }
  const state = () => {
    const transform = wrap.querySelector("svg")?.style.transform ?? "";
    const [x, y, z] = transform.match(/-?[\d.]+/g)?.map(Number) ?? [];
    if (x === undefined || y === undefined || z === undefined) throw new Error(transform);
    return { x, y, z };
  };
  const pointer = (type: string, x: number, y: number, button = 0, id = 1) => {
    const event = new MouseEvent(type, { clientX: x, clientY: y, button, bubbles: true });
    Object.defineProperties(event, { pointerId: { value: id }, isPrimary: { value: true } });
    wrap.dispatchEvent(event);
  };
  const click = (id: string) => {
    doc.getElementById(id)?.click();
  };
  return {
    doc,
    win,
    wrap,
    state,
    pointer,
    click,
    captured: () => capture,
    resize(w: number, h: number) {
      width = w;
      height = h;
      onResize();
    },
  };
}

describe("diagram viewport", () => {
  it("starts at readable scale and refits when the viewport grows", () => {
    const ui = mount();
    expect(ui.state().z).toBeGreaterThanOrEqual(0.8);
    ui.click("diagram-fit");
    const small = ui.state();
    expect(small.z).toBeLessThan(0.8);
    ui.resize(1100, 760);
    expect(ui.state().z).toBeGreaterThan(small.z);
    ui.click("diagram-scale");
    expect(ui.state().z).toBe(1);
  });

  it("pans with the primary mouse button and releases capture on cancellation", () => {
    const ui = mount();
    const start = ui.state();
    ui.pointer("pointerdown", 100, 100, 2);
    ui.pointer("pointermove", 150, 180);
    expect(ui.state()).toEqual(start);
    ui.pointer("pointerdown", 100, 100);
    expect(ui.captured()).toBe(1);
    ui.pointer("pointermove", 140, 160);
    expect(ui.state()).toEqual({ ...start, x: start.x + 40, y: start.y + 60 });
    ui.pointer("pointercancel", 140, 160);
    expect(ui.captured()).toBeUndefined();
    expect(ui.wrap.hasAttribute("data-dragging")).toBe(false);
    const end = ui.state();
    ui.pointer("pointermove", 300, 300);
    expect(ui.state()).toEqual(end);
  });

  it("keeps the zoom anchor fixed and blocks the old renderer wheel listener", () => {
    const ui = mount();
    let legacyCalls = 0;
    ui.win.addEventListener("wheel", () => {
      legacyCalls++;
    });
    const before = ui.state();
    ui.wrap.dispatchEvent(
      new WheelEvent("wheel", {
        clientX: 200,
        clientY: 120,
        deltaY: -120,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    const after = ui.state();
    expect(after.z).toBeGreaterThan(before.z);
    expect((200 - after.x) / after.z).toBeCloseTo((200 - before.x) / before.z);
    expect((120 - after.y) / after.z).toBeCloseTo((120 - before.y) / before.z);
    expect(legacyCalls).toBe(0);
  });

  it("preserves manual zoom and the center point across resizes", () => {
    const ui = mount();
    ui.pointer("pointerdown", 100, 100);
    ui.pointer("pointermove", 50, 80);
    ui.pointer("pointerup", 50, 80);
    const before = ui.state();
    ui.resize(770, 660);
    expect(ui.state()).toEqual({ x: before.x + 100, y: before.y + 100, z: before.z });
  });

  it("supports keyboard pan and zoom without a pointer", () => {
    const ui = mount();
    const before = ui.state();
    ui.wrap.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    expect(ui.state().x).toBeLessThan(before.x);
    ui.wrap.dispatchEvent(new KeyboardEvent("keydown", { key: "+" }));
    expect(ui.state().z).toBeGreaterThan(before.z);
  });
});

describe("legacy diagram enhancement", () => {
  it("leaves unrelated HTML intact and adds controls only once to recognized diagrams", () => {
    const unrelated = "<html><body><h1>Demo</h1></body></html>";
    expect(withDiagramViewport(unrelated)).toBe(unrelated);
    const legacy =
      '<html><body><div id="wrap"></div><script>globalThis.__SVG="";globalThis.__LAYOUT={};</script></body></html>';
    const enhanced = withDiagramViewport(legacy);
    expect(enhanced).toContain('id="harpyhare-diagram-viewport"');
    expect(withDiagramViewport(enhanced)).toBe(enhanced);
  });
});

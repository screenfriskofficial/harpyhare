import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { parseSystemDesign } from "@/lib/system-design";
import { CLUSTER_Z_INDEX, flowElements } from "./flow-elements";
import { SystemDesignDiagram } from "./SystemDesignDiagram";

const DESIGN = parseSystemDesign(
  JSON.stringify({
    version: 1,
    TITLE: "Feed v1",
    NODES: [
      { id: "client", col: 0, kind: "client", title: "Client" },
      { id: "api", col: 1, kind: "service", title: "API", sub: ["auth"], badge: "stateless xN" },
      { id: "queue", col: 2, kind: "queue", title: "Queue" },
      { id: "db", col: 2, kind: "db", title: "Database" },
    ],
    EDGES: [
      { from: "client", to: "api", label: "HTTPS" },
      { from: "api", to: "queue", label: "publish", async: true },
      { from: "db", to: "api", label: "notify" },
    ],
    GROUPS: [{ label: "Storage", nodes: ["queue", "db"] }],
  }),
);

function design() {
  if (DESIGN === null) throw new Error("fixture must parse");
  return DESIGN;
}

afterEach(() => {
  cleanup();
});

describe("flowElements", () => {
  it("emits sized read-only cards, clusters beneath them, corner anchors and routed edges", () => {
    const { nodes, edges, width, height } = flowElements(design());
    const card = nodes.find((node) => node.id === "api");
    const cluster = nodes.find((node) => node.type === "cluster");
    if (!card || !cluster) throw new Error("card or cluster missing");
    expect(card).toMatchObject({ type: "card", draggable: false, selectable: false });
    expect(card.width).toBeGreaterThan(0);
    expect(card.height).toBeGreaterThan(0);
    expect(cluster).toMatchObject({
      zIndex: CLUSTER_Z_INDEX,
      data: { cluster: { label: "Storage" } },
    });
    expect(nodes.indexOf(cluster)).toBeLessThan(nodes.indexOf(card));
    expect(nodes.filter((node) => node.type === "anchor").map((node) => node.position)).toEqual([
      { x: 0, y: 0 },
      { x: width - 1, y: height - 1 },
    ]);
    expect(edges).toHaveLength(3);
    expect(edges[1]).toMatchObject({ from: "api", to: "queue", label: "publish", async: true });
    expect(edges.every((edge) => edge.points.length >= 4)).toBe(true);
  });
});

describe("SystemDesignDiagram", () => {
  it("renders every card with its kind, lines, badge and the group label", () => {
    render(<SystemDesignDiagram design={design()} viewportMemory={{ current: null }} />);
    expect(screen.getByText("Client")).not.toBeNull();
    expect(screen.getByText("API")).not.toBeNull();
    expect(screen.getByText("auth")).not.toBeNull();
    expect(screen.getByText("stateless xN")).not.toBeNull();
    expect(screen.getByText("Storage")).not.toBeNull();
    expect(screen.getAllByText("хранилище")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Вписать" })).not.toBeNull();
  });

  it("draws the routed edges and their labels as its own overlay", async () => {
    const { container } = render(
      <SystemDesignDiagram design={design()} viewportMemory={{ current: null }} />,
    );
    await waitFor(() => {
      expect(container.querySelectorAll("path[marker-end]")).toHaveLength(3);
    });
    const dashed = [...container.querySelectorAll("path[marker-end]")].filter((path) =>
      path.hasAttribute("stroke-dasharray"),
    );
    expect(dashed).toHaveLength(1);
    expect(screen.getByText("publish").tagName).toBe("text");
  });
});

describe("SystemDesignDiagram highlight", () => {
  function card(container: HTMLElement, id: string): HTMLElement {
    const element = container.querySelector<HTMLElement>(`[data-card="${id}"]`);
    if (!element) throw new Error(`card ${id} missing`);
    return element;
  }
  const emphasis = (container: HTMLElement, id: string) =>
    card(container, id).getAttribute("data-emphasis");

  it("lights a clicked arrow with the two cards it connects and fades the other arrows", async () => {
    const { container } = render(
      <SystemDesignDiagram design={design()} viewportMemory={{ current: null }} />,
    );
    const arrow = await screen.findByRole("button", { name: "Связь Client → API: HTTPS" });
    fireEvent.click(arrow);
    expect(arrow.getAttribute("aria-pressed")).toBe("true");
    expect(arrow.getAttribute("data-highlighted")).toBe("true");
    expect(container.querySelectorAll("[data-dimmed]")).toHaveLength(2);
    expect(emphasis(container, "client")).toBe("related");
    expect(emphasis(container, "api")).toBe("related");
    expect(emphasis(container, "queue")).toBeNull();
    // The lit arrow is drawn last, over the faded ones.
    const arrows = [...container.querySelectorAll("g[role='button']")];
    expect(arrows.indexOf(arrow)).toBe(arrows.length - 1);
    fireEvent.click(arrow);
    expect(arrow.getAttribute("aria-pressed")).toBe("false");
    expect(container.querySelectorAll("[data-dimmed]")).toHaveLength(0);
    expect(emphasis(container, "client")).toBeNull();
  });

  it("lights a clicked card with every arrow it has and the cards at their other ends", async () => {
    const { container } = render(
      <SystemDesignDiagram design={design()} viewportMemory={{ current: null }} />,
    );
    await screen.findByRole("button", { name: "Связь Client → API: HTTPS" });
    fireEvent.click(card(container, "api"));
    expect(emphasis(container, "api")).toBe("selected");
    expect(emphasis(container, "client")).toBe("related");
    expect(emphasis(container, "queue")).toBe("related");
    expect(emphasis(container, "db")).toBe("related");
    expect(container.querySelectorAll("[data-highlighted]")).toHaveLength(3);
    expect(container.querySelectorAll("[data-dimmed]")).toHaveLength(0);
    expect(screen.getByText("publish").getAttribute("font-weight")).toBe("600");
    fireEvent.click(card(container, "api"));
    expect(emphasis(container, "api")).toBeNull();
    expect(container.querySelectorAll("[data-highlighted]")).toHaveLength(0);
  });

  it("moves the highlight to another arrow and clears it on a click on the empty canvas", async () => {
    const { container } = render(
      <SystemDesignDiagram design={design()} viewportMemory={{ current: null }} />,
    );
    const https = await screen.findByRole("button", { name: "Связь Client → API: HTTPS" });
    const notify = screen.getByRole("button", { name: "Связь Database → API: notify" });
    fireEvent.click(https);
    fireEvent.click(notify);
    expect(https.getAttribute("aria-pressed")).toBe("false");
    expect(notify.getAttribute("aria-pressed")).toBe("true");
    expect(emphasis(container, "client")).toBeNull();
    expect(emphasis(container, "db")).toBe("related");
    const pane = container.querySelector(".react-flow__pane");
    if (!pane) throw new Error("pane missing");
    fireEvent.click(pane);
    expect(notify.getAttribute("aria-pressed")).toBe("false");
    expect(emphasis(container, "db")).toBeNull();
  });
});

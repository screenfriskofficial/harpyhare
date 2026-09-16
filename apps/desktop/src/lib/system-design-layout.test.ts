import { describe, expect, it } from "vitest";
import { parseSystemDesign, type SystemDesign } from "./system-design";
import {
  CROSSING_STEP,
  LABEL_FONT_PX,
  labelWidth,
  layoutSystemDesign,
  MARGIN,
  MIN_NODE_WIDTH,
  PORT_SPACING,
  type LaidOutNode,
  type Point,
  type RoutedEdge,
  type SystemDesignLayout,
} from "./system-design-layout";

const DATA = {
  version: 1,
  TITLE: "Feed v1",
  NODES: [
    { id: "client", col: 0, kind: "client", title: "Client", sub: [] },
    { id: "api", col: 1, kind: "service", title: "API", badge: "stateless xN" },
    { id: "queue", col: 2, kind: "queue", title: "Queue", sub: ["events"] },
    { id: "db", col: 2, kind: "db", title: "Database" },
  ],
  EDGES: [
    { from: "client", to: "api", label: "HTTPS" },
    { from: "api", to: "queue", label: "publish", async: true },
    { from: "client", to: "db", label: "read" },
    { from: "queue", to: "db", label: "write" },
    { from: "db", to: "api", label: "notify", async: true },
  ],
  GROUPS: [{ label: "Storage", nodes: ["queue", "db"] }],
};

/** One hub fanning out to five targets: many ports on one face, one long label. */
const HUB = {
  ...DATA,
  TITLE: "Hub",
  NODES: [
    { id: "hub", col: 0, kind: "service", title: "Hub" },
    ...Array.from({ length: 5 }, (_, i) => ({
      id: `t${i}`,
      col: 1,
      kind: "db",
      title: `Target ${i}`,
    })),
  ],
  EDGES: Array.from({ length: 5 }, (_, i) => ({
    from: "hub",
    to: `t${i}`,
    label: i === 0 ? "a very long edge label here" : "x",
  })),
  GROUPS: [],
};

/** The feed plus two edges going back over two layers: buses above the cards. */
const BUSY = {
  ...DATA,
  TITLE: "Busy",
  EDGES: [
    ...DATA.EDGES,
    { from: "db", to: "client", label: "push" },
    { from: "queue", to: "client", label: "events" },
  ],
};

/** A source and a target with two cards in between: the straight line hits the gap. */
const GAP = {
  version: 1,
  TITLE: "Gap",
  NODES: [
    { id: "s", col: 0, kind: "service", title: "Source" },
    { id: "m1", col: 1, kind: "service", title: "Upper" },
    { id: "m2", col: 1, kind: "service", title: "Lower" },
    { id: "d", col: 2, kind: "db", title: "Target" },
  ],
  EDGES: [{ from: "s", to: "d" }],
  GROUPS: [],
};

/** Two sources whose skipping edges both take the same gap. */
const FAN = {
  ...GAP,
  TITLE: "Fan",
  NODES: [
    { id: "s1", col: 0, kind: "service", title: "First" },
    { id: "s2", col: 0, kind: "service", title: "Second" },
    ...GAP.NODES.filter((node) => node.col > 0),
  ],
  EDGES: [
    { from: "s1", to: "d" },
    { from: "s2", to: "d" },
  ],
};

const BUSES = {
  version: 1,
  TITLE: "Buses",
  NODES: [
    { id: "a", col: 0, kind: "client", title: "A" },
    { id: "b", col: 1, kind: "service", title: "B" },
    { id: "c", col: 2, kind: "db", title: "C" },
    { id: "d", col: 2, kind: "queue", title: "D" },
  ],
  EDGES: [
    { from: "c", to: "a", label: "push" },
    { from: "d", to: "a" },
  ],
  GROUPS: [],
};

function parsed(data: unknown): SystemDesign {
  const design = parseSystemDesign(JSON.stringify(data));
  if (design === null) throw new Error("Expected a valid diagram");
  return design;
}

function nodeById(layout: SystemDesignLayout, id: string): LaidOutNode {
  const node = layout.nodes.find((item) => item.id === id);
  if (!node) throw new Error(`layout lost node ${id}`);
  return node;
}

function edgeBetween(layout: SystemDesignLayout, from: string, to: string): RoutedEdge {
  const edge = layout.edges.find((item) => item.from === from && item.to === to);
  if (!edge) throw new Error(`edge ${from}->${to} missing`);
  return edge;
}

function pointAt(edge: RoutedEdge, index: number): Point {
  const point = edge.points.at(index);
  if (!point) throw new Error(`edge ${edge.id} has no point ${index}`);
  return point;
}

const FIXTURES: [string, unknown][] = [
  ["feed", DATA],
  ["hub", HUB],
  ["busy", BUSY],
];

describe("layoutSystemDesign", () => {
  it("places layers in columns, keeps array order inside a column and centres short columns", () => {
    const layout = layoutSystemDesign(parsed(DATA));
    const client = nodeById(layout, "client");
    const api = nodeById(layout, "api");
    const queue = nodeById(layout, "queue");
    const db = nodeById(layout, "db");
    expect(api.x).toBeGreaterThan(client.x + MIN_NODE_WIDTH);
    expect(queue.x).toBe(db.x);
    expect(db.y).toBeGreaterThan(queue.y + queue.height);
    // Single-node columns sit at the vertical middle of the tallest column.
    expect(client.y).toBeGreaterThan(queue.y);
    expect(api.height).toBeGreaterThan(client.height);
    expect(layout.width).toBeGreaterThan(db.x + db.width);
    expect(layout.height).toBeGreaterThan(db.y + db.height);
    expect(layout.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y))).toBe(
      true,
    );
  });

  it("sizes a card to its longest line instead of truncating it", () => {
    const wide = parsed({
      ...DATA,
      NODES: [
        { id: "client", col: 0, kind: "client", title: "Client" },
        { id: "api", col: 1, kind: "service", title: "API", sub: ["a very long description line"] },
      ],
      EDGES: [],
      GROUPS: [],
    });
    const [client, api] = layoutSystemDesign(wide).nodes;
    expect(api?.width ?? 0).toBeGreaterThan(client?.width ?? 0);
  });

  it("gives every edge its own lane, threads skips through a gap, turns adjacent backs in place and labels on the line", () => {
    const layout = layoutSystemDesign(parsed(DATA));
    const client = nodeById(layout, "client");
    const api = nodeById(layout, "api");
    const db = nodeById(layout, "db");
    const adjacent = edgeBetween(layout, "client", "api");
    expect(adjacent.points).toHaveLength(4);
    expect(pointAt(adjacent, 0).x).toBe(client.x + client.width);
    expect(adjacent.labelAnchor).toBe("start");
    expect(adjacent.labelY).toBe(pointAt(adjacent, 0).y);
    // The label fits on the first segment, before the first lane of the corridor.
    expect(adjacent.labelX + labelWidth("HTTPS")).toBeLessThan(pointAt(adjacent, 1).x);
    const skip = edgeBetween(layout, "client", "db");
    expect(skip.points).toHaveLength(6);
    const crossingY = pointAt(skip, 2).y;
    expect(crossingY < api.y || crossingY > api.y + api.height).toBe(true);
    expect(pointAt(skip, 3).y).toBe(crossingY);
    const back = edgeBetween(layout, "db", "api");
    expect(back.points).toHaveLength(4);
    expect(pointAt(back, 0).x).toBe(db.x);
    expect(pointAt(back, 1).x).toBeGreaterThan(api.x + api.width);
    expect(pointAt(back, 1).x).toBeLessThan(db.x);
    expect(back.async).toBe(true);
    expect(back.labelAnchor).toBe("end");
    const same = edgeBetween(layout, "queue", "db");
    expect(same.points).toHaveLength(4);
    expect(pointAt(same, -1).x).toBe(db.x + db.width);
    // Two edges leaving the client take different lanes and different ports, a label's height apart.
    expect(pointAt(adjacent, 1).x).not.toBe(pointAt(skip, 1).x);
    expect(Math.abs(pointAt(adjacent, 0).y - pointAt(skip, 0).y)).toBeGreaterThanOrEqual(
      PORT_SPACING,
    );
    expect(layout.height).toBeGreaterThan(db.y + db.height);
    expect(
      layout.edges.every((item) =>
        item.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
      ),
    ).toBe(true);
  });

  it("sends an edge that goes back more than one layer over the top on a bus", () => {
    const layout = layoutSystemDesign(
      parsed({
        ...DATA,
        EDGES: [{ from: "db", to: "client", label: "push" }],
        GROUPS: [],
      }),
    );
    const client = nodeById(layout, "client");
    const db = nodeById(layout, "db");
    const back = edgeBetween(layout, "db", "client");
    expect(back.points).toHaveLength(6);
    expect(pointAt(back, 0).x).toBe(db.x);
    expect(pointAt(back, 2).y).toBeLessThan(Math.min(...layout.nodes.map((node) => node.y)));
    expect(pointAt(back, -1).x).toBe(client.x + client.width);
  });

  it("gives far-back edges distinct bus heights above every card", () => {
    const layout = layoutSystemDesign(parsed(BUSES));
    const top = Math.min(...layout.nodes.map((node) => node.y));
    const buses = ["c", "d"].map((from) => pointAt(edgeBetween(layout, from, "a"), 2).y);
    expect(buses[0]).not.toBe(buses[1]);
    for (const y of buses) expect(y).toBeLessThan(top);
  });

  it("makes a card tall enough for its ports and reserves corridor room for the longest label", () => {
    const layout = layoutSystemDesign(parsed(HUB));
    const hub = nodeById(layout, "hub");
    expect(hub.height).toBeGreaterThanOrEqual(6 * PORT_SPACING);
    const firstLane = Math.min(...layout.edges.map((edge) => pointAt(edge, 1).x));
    expect(firstLane - (hub.x + hub.width)).toBeGreaterThan(
      labelWidth("a very long edge label here"),
    );
  });

  it.each(FIXTURES)("keeps the ports of every face at least PORT_SPACING apart (%s)", (_, data) => {
    const layout = layoutSystemDesign(parsed(data));
    const portsByFace = new Map<string, number[]>();
    const record = (id: string, port: Point) => {
      const node = nodeById(layout, id);
      expect([node.x, node.x + node.width]).toContain(port.x);
      const key = `${id}:${port.x === node.x ? "left" : "right"}`;
      portsByFace.set(key, [...(portsByFace.get(key) ?? []), port.y]);
    };
    for (const edge of layout.edges) {
      record(edge.from, pointAt(edge, 0));
      record(edge.to, pointAt(edge, -1));
    }
    expect([...portsByFace.values()].some((ys) => ys.length > 1)).toBe(true);
    for (const ys of portsByFace.values()) {
      ys.sort((a, b) => a - b);
      for (let i = 1; i < ys.length; i++) {
        expect((ys[i] ?? 0) - (ys[i - 1] ?? 0)).toBeGreaterThanOrEqual(PORT_SPACING);
      }
    }
  });

  it.each(FIXTURES)("reserves corridor room so no label reaches the first lane (%s)", (_, data) => {
    const layout = layoutSystemDesign(parsed(data));
    const labeled = layout.edges.filter((edge) => edge.label !== null);
    expect(labeled.length).toBeGreaterThan(0);
    for (const edge of labeled) {
      const width = labelWidth(edge.label ?? "");
      const lane = pointAt(edge, 1).x;
      if (edge.labelAnchor === "start") expect(edge.labelX + width).toBeLessThan(lane);
      else expect(edge.labelX - width).toBeGreaterThan(lane);
    }
  });

  it("threads an edge that skips a layer through the gap between the cards it crosses", () => {
    const layout = layoutSystemDesign(parsed(GAP));
    const upper = nodeById(layout, "m1");
    const lower = nodeById(layout, "m2");
    const skip = edgeBetween(layout, "s", "d");
    expect(skip.points).toHaveLength(6);
    const crossingY = pointAt(skip, 2).y;
    expect(crossingY).toBeGreaterThan(upper.y + upper.height);
    expect(crossingY).toBeLessThan(lower.y);
    expect(pointAt(skip, 3).y).toBe(crossingY);
  });

  it("fans out lines sharing a gap by CROSSING_STEP without leaving it", () => {
    const layout = layoutSystemDesign(parsed(FAN));
    const upper = nodeById(layout, "m1");
    const lower = nodeById(layout, "m2");
    const [first, second] = ["s1", "s2"].map(
      (from) => pointAt(edgeBetween(layout, from, "d"), 2).y,
    );
    for (const y of [first ?? Number.NaN, second ?? Number.NaN]) {
      expect(y).toBeGreaterThan(upper.y + upper.height);
      expect(y).toBeLessThan(lower.y);
    }
    expect(Math.abs((first ?? 0) - (second ?? 0))).toBeGreaterThanOrEqual(CROSSING_STEP);
  });

  it("wraps a group around its members with room for the label", () => {
    const layout = layoutSystemDesign(parsed(DATA));
    const group = layout.groups[0];
    const members = layout.nodes.filter((node) => ["queue", "db"].includes(node.id));
    if (!group) throw new Error("group missing");
    expect(group.label).toBe("Storage");
    for (const member of members) {
      expect(member.x).toBeGreaterThan(group.x);
      expect(member.y).toBeGreaterThan(group.y);
      expect(member.x + member.width).toBeLessThan(group.x + group.width);
      expect(member.y + member.height).toBeLessThan(group.y + group.height);
    }
  });

  it("pads everything drawn to MARGIN from the top-left corner and sizes the canvas to the far edge", () => {
    const layout = layoutSystemDesign(parsed(BUSY));
    const xs: number[] = [];
    const ys: number[] = [];
    for (const box of [...layout.nodes, ...layout.groups]) {
      xs.push(box.x, box.x + box.width);
      ys.push(box.y, box.y + box.height);
    }
    for (const edge of layout.edges) {
      for (const point of edge.points) {
        xs.push(point.x);
        ys.push(point.y);
      }
      if (edge.label !== null) {
        const width = labelWidth(edge.label);
        xs.push(
          edge.labelX,
          edge.labelAnchor === "start" ? edge.labelX + width : edge.labelX - width,
        );
        ys.push(edge.labelY - LABEL_FONT_PX / 2, edge.labelY + LABEL_FONT_PX / 2);
      }
    }
    expect(Math.min(...xs)).toBeCloseTo(MARGIN);
    expect(Math.min(...ys)).toBeCloseTo(MARGIN);
    expect(layout.width).toBeCloseTo(Math.max(...xs) + MARGIN);
    expect(layout.height).toBeCloseTo(Math.max(...ys) + MARGIN);
  });

  it("gives edges unique ids that survive a re-layout of the same design", () => {
    const design = parsed(BUSY);
    const ids = layoutSystemDesign(design).edges.map((edge) => edge.id);
    expect(new Set(ids).size).toBe(design.EDGES.length);
    expect(layoutSystemDesign(design).edges.map((edge) => edge.id)).toEqual(ids);
  });
});

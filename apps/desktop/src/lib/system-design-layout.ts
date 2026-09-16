import type {
  SystemDesign,
  SystemDesignEdge,
  SystemDesignGroup,
  SystemDesignKind,
  SystemDesignNode,
} from "./system-design";

/**
 * Where every card, group and edge goes — routing derived from the previous
 * SVG renderer, so the canvas only pans and zooms.
 *
 * Columns are the model's layers, the order inside a column is the order of
 * the array, and short columns are centred on the tallest one. Every edge
 * gets its own vertical lane in the corridor between two columns, so two
 * edges never share a segment. Each corridor first reserves room for the
 * labels that start there, then its lanes: a label sits on its own line, at
 * the source end, and never crosses another edge. Ports are spread along a
 * card's faces in the order of the other end, at least a label's height
 * apart, and a card grows to make that room. An edge that skips a layer
 * threads through a gap between the cards of the layer it crosses; an edge
 * that goes back one layer turns in the corridor between the two; an edge
 * that goes back further travels over the diagram on a bus.
 */
export interface LaidOutNode {
  id: string;
  kind: SystemDesignKind;
  title: string;
  sub: string[];
  badge: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LaidOutGroup {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface RoutedEdge {
  id: string;
  from: string;
  to: string;
  label: string | null;
  async: boolean;
  /** An orthogonal polyline from the source face to the target face. */
  points: Point[];
  /** The label's anchor, on the first segment of the edge. */
  labelX: number;
  labelY: number;
  labelAnchor: "start" | "end";
}

export interface SystemDesignLayout {
  nodes: LaidOutNode[];
  groups: LaidOutGroup[];
  edges: RoutedEdge[];
  width: number;
  height: number;
}

export const MIN_NODE_WIDTH = 180;
const MIN_NODE_HEIGHT = 72;
const TITLE_FONT_PX = 13;
const SUB_FONT_PX = 11.5;
export const LABEL_FONT_PX = 11;
/** Average glyph width as a fraction of the font size for the UI sans stack. */
const CHAR_WIDTH = 0.62;
const NODE_PADDING_X = 16;
const NODE_PADDING_Y = 12;
const KIND_LINE_PX = 16;
const TITLE_LINE_PX = 22;
const SUB_LINE_PX = 17;
const BADGE_LINE_PX = 22;
/** Ports on one face are at least this far apart: a label must fit on its own line. */
export const PORT_SPACING = 20;
const ROW_GAP = 48;
export const MARGIN = 32;
/** The corridor between two columns is never narrower than this. */
const MIN_CORRIDOR = 120;
const LANE = 18;
const LANE_MARGIN = 24;
const BUS = 24;
const BUS_GAP = 32;
const GROUP_PADDING = 14;
const GROUP_LABEL_PX = 18;
const LABEL_OFFSET_X = 6;
/** Lines crossing the same gap between two cards run this far apart. */
export const CROSSING_STEP = 12;
/** A gap between two cards (or a card and a group label) must be at least this tall to thread an edge through. */
const MIN_CROSSING_BAND = 16;
/** A line threaded through a gap keeps this far from the cards on either side. */
const CROSSING_INSET = 4;

type EdgeType = "adj" | "skip" | "same" | "back" | "farBack";
type Face = "left" | "right";

interface FaceLoad {
  left: number;
  right: number;
}

interface Interval {
  start: number;
  end: number;
}

interface ClassifiedEdge {
  edge: SystemDesignEdge;
  /** Position in `EDGES`: the stable part of the edge id. */
  index: number;
  type: EdgeType;
  aCol: number;
  bCol: number;
}

interface Lane {
  corridor: number;
  index: number;
}

interface Crossing {
  /** Which free band of the column the line uses: an index between cards, or the open space outside them. */
  band: string;
  /** Where the straight line between the edge's ends would cross the column. */
  wanted: number;
  y: number;
}

interface FreeBand {
  key: string;
  side: "above" | "between" | "below";
  y: number;
  /** Extent of the free space for a band between cards; unbounded outside. */
  start: number;
  end: number;
}

/**
 * The working record of one edge, filled in phase by phase: `lanes` by
 * `assignLanes`, `busY` by `assignBuses`, `ay`/`by` by `assignPorts`,
 * `crossings` by `threadCrossings`. `a` and `b` are the very card records
 * `stackColumns` positions, so every later phase reads x/y through them.
 */
interface Route {
  id: string;
  from: string;
  to: string;
  label: string | null;
  async: boolean;
  type: EdgeType;
  a: LaidOutNode;
  aCol: number;
  b: LaidOutNode;
  bCol: number;
  lanes: Lane[];
  crossings: Crossing[];
  ay: number;
  by: number;
  busY: number;
}

interface Corridors {
  /** Lanes taken in the corridor to the right of each column. */
  lanes: Map<number, number>;
  /** Width reserved at a corridor's start for labels of edges leaving its column to the right. */
  leftRoom: Map<number, number>;
  /** Width reserved at a corridor's end for labels of edges leaving the next column to the left. */
  rightRoom: Map<number, number>;
}

interface GroupBox {
  box: LaidOutGroup;
  /** Columns the group spans: its label band blocks the lines threaded through them. */
  columns: Set<number>;
}

export function labelWidth(text: string): number {
  return text.length * LABEL_FONT_PX * CHAR_WIDTH;
}

function textWidth(text: string, fontPx: number): number {
  return text.length * fontPx * CHAR_WIDTH;
}

function nodeSize(node: SystemDesignNode, ports: number): { width: number; height: number } {
  const sub = node.sub ?? [];
  const lineWidths = [
    textWidth(node.title, TITLE_FONT_PX),
    ...sub.map((line) => textWidth(line, SUB_FONT_PX)),
    ...(node.badge ? [textWidth(node.badge, SUB_FONT_PX)] : []),
  ];
  const content =
    2 * NODE_PADDING_Y +
    KIND_LINE_PX +
    TITLE_LINE_PX +
    sub.length * SUB_LINE_PX +
    (node.badge ? BADGE_LINE_PX : 0);
  return {
    width: Math.max(MIN_NODE_WIDTH, Math.max(...lineWidths) + 2 * NODE_PADDING_X),
    height: Math.max(MIN_NODE_HEIGHT, content, (ports + 1) * PORT_SPACING),
  };
}

function edgeType(aCol: number, bCol: number): EdgeType {
  const delta = bCol - aCol;
  if (delta === 1) return "adj";
  if (delta > 1) return "skip";
  if (delta === 0) return "same";
  return delta === -1 ? "back" : "farBack";
}

/**
 * Which face of each card an edge uses: a rightward edge leaves the right
 * face and arrives at the left one, a leftward edge the reverse, and an edge
 * inside one column uses the right face at both ends.
 */
function edgeFaces(type: EdgeType): { a: Face; b: Face } {
  switch (type) {
    case "back":
    case "farBack":
      return { a: "left", b: "right" };
    case "same":
      return { a: "right", b: "right" };
    case "adj":
    case "skip":
      return { a: "right", b: "left" };
  }
}

function routePoints(route: Route, laneX: (lane: Lane) => number): Point[] {
  const { a, b, ay, by, busY } = route;
  const lanes = route.lanes.map(laneX);
  const [first, second] = lanes;
  if (first === undefined) return [];
  switch (route.type) {
    case "adj":
      return [
        { x: a.x + a.width, y: ay },
        { x: first, y: ay },
        { x: first, y: by },
        { x: b.x, y: by },
      ];
    case "same":
      return [
        { x: a.x + a.width, y: ay },
        { x: first, y: ay },
        { x: first, y: by },
        { x: b.x + b.width, y: by },
      ];
    case "back":
      return [
        { x: a.x, y: ay },
        { x: first, y: ay },
        { x: first, y: by },
        { x: b.x + b.width, y: by },
      ];
    case "skip": {
      // Lane k carries the edge from crossing k-1 to crossing k; the last lane ends at the target.
      const points: Point[] = [{ x: a.x + a.width, y: ay }];
      let y = ay;
      lanes.forEach((x, k) => {
        const next = route.crossings[k]?.y ?? by;
        points.push({ x, y }, { x, y: next });
        y = next;
      });
      points.push({ x: b.x, y: by });
      return points;
    }
    case "farBack":
      if (second === undefined) return [];
      return [
        { x: a.x, y: ay },
        { x: first, y: ay },
        { x: first, y: busY },
        { x: second, y: busY },
        { x: second, y: by },
        { x: b.x + b.width, y: by },
      ];
  }
}

/** Edges whose ends both exist, with the layer relation that decides their route. */
function classifyEdges(edges: SystemDesignEdge[], columnOf: Map<string, number>): ClassifiedEdge[] {
  return edges.flatMap((edge, index) => {
    const aCol = columnOf.get(edge.from);
    const bCol = columnOf.get(edge.to);
    if (aCol === undefined || bCol === undefined) return [];
    return [{ edge, index, type: edgeType(aCol, bCol), aCol, bCol }];
  });
}

/** How many ports each face of each card needs; that decides how tall the card is. */
function portLoad(nodes: SystemDesignNode[], classified: ClassifiedEdge[]): Map<string, FaceLoad> {
  const load = new Map<string, FaceLoad>(nodes.map((node) => [node.id, { left: 0, right: 0 }]));
  for (const { edge, type } of classified) {
    const faces = edgeFaces(type);
    const a = load.get(edge.from);
    const b = load.get(edge.to);
    if (!a || !b) continue;
    a[faces.a] += 1;
    b[faces.b] += 1;
  }
  return load;
}

/** Cards sized for their text and ports, still at the origin, bucketed by layer in array order. */
function sizeCards(
  nodes: SystemDesignNode[],
  load: Map<string, FaceLoad>,
): { placed: Map<string, LaidOutNode>; columns: LaidOutNode[][] } {
  const columnCount = Math.max(...nodes.map((node) => node.col)) + 1;
  const placed = new Map<string, LaidOutNode>();
  const columns: LaidOutNode[][] = Array.from({ length: columnCount }, () => []);
  for (const node of nodes) {
    const ports = load.get(node.id) ?? { left: 0, right: 0 };
    const card: LaidOutNode = {
      id: node.id,
      kind: node.kind,
      title: node.title,
      sub: node.sub ?? [],
      badge: node.badge ?? null,
      x: 0,
      y: 0,
      ...nodeSize(node, Math.max(ports.left, ports.right)),
    };
    placed.set(node.id, card);
    columns[node.col]?.push(card);
  }
  return { placed, columns };
}

/**
 * Corridor c lies to the right of column c. Labels of edges leaving column c
 * to the right are reserved at its start, labels of edges leaving column
 * c+1 to the left at its end; the lanes run in between, one per edge.
 */
function assignLanes(
  classified: ClassifiedEdge[],
  placed: Map<string, LaidOutNode>,
): { routes: Route[]; corridors: Corridors } {
  const corridors: Corridors = { lanes: new Map(), leftRoom: new Map(), rightRoom: new Map() };
  const reserve = (room: Map<number, number>, corridor: number, label: string | null) => {
    if (label === null) return;
    room.set(corridor, Math.max(room.get(corridor) ?? 0, labelWidth(label)));
  };
  const takeLane = (corridor: number, route: Route) => {
    const index = corridors.lanes.get(corridor) ?? 0;
    corridors.lanes.set(corridor, index + 1);
    route.lanes.push({ corridor, index });
  };
  const routes = classified.flatMap(({ edge, index, type, aCol, bCol }) => {
    const a = placed.get(edge.from);
    const b = placed.get(edge.to);
    if (!a || !b) return [];
    const route: Route = {
      id: `edge-${index}`,
      from: edge.from,
      to: edge.to,
      label: edge.label ?? null,
      async: edge.async ?? false,
      type,
      a,
      aCol,
      b,
      bCol,
      lanes: [],
      crossings: [],
      ay: 0,
      by: 0,
      busY: 0,
    };
    switch (type) {
      case "adj":
      case "same":
        takeLane(aCol, route);
        reserve(corridors.leftRoom, aCol, route.label);
        break;
      case "skip":
        for (let corridor = aCol; corridor < bCol; corridor++) takeLane(corridor, route);
        reserve(corridors.leftRoom, aCol, route.label);
        break;
      case "back":
        takeLane(bCol, route);
        reserve(corridors.rightRoom, bCol, route.label);
        break;
      case "farBack":
        takeLane(aCol - 1, route);
        takeLane(bCol, route);
        reserve(corridors.rightRoom, aCol - 1, route.label);
        break;
    }
    return [route];
  });
  return { routes, corridors };
}

/** Where each column starts and where every lane runs, from the card widths and what each corridor holds. */
function horizontalGeometry(
  columns: LaidOutNode[][],
  corridors: Corridors,
): { columnX: number[]; columnWidth: number[]; laneX: (lane: Lane) => number } {
  const columnWidth = columns.map((list) => Math.max(0, ...list.map((node) => node.width)));
  const laneStart = (corridor: number) =>
    LABEL_OFFSET_X + (corridors.leftRoom.get(corridor) ?? 0) + LANE_MARGIN;
  const corridorWidth = (corridor: number): number => {
    const lanes = corridors.lanes.get(corridor) ?? 0;
    if (corridor === columns.length - 1) {
      // The corridor past the last column exists only when something turns there.
      return lanes === 0 ? 0 : laneStart(corridor) + (lanes - 1) * LANE + LANE_MARGIN;
    }
    return Math.max(
      MIN_CORRIDOR,
      laneStart(corridor) +
        Math.max(0, lanes - 1) * LANE +
        LANE_MARGIN +
        (corridors.rightRoom.get(corridor) ?? 0) +
        LABEL_OFFSET_X,
    );
  };
  const columnX: number[] = [];
  let x = MARGIN;
  for (let c = 0; c < columns.length; c++) {
    columnX[c] = x;
    x += (columnWidth[c] ?? 0) + corridorWidth(c);
  }
  const laneX = (lane: Lane): number =>
    (columnX[lane.corridor] ?? 0) +
    (columnWidth[lane.corridor] ?? 0) +
    laneStart(lane.corridor) +
    lane.index * LANE;
  return { columnX, columnWidth, laneX };
}

/** Buses of the far-back edges run above the cards, one line each; returns the height of that band. */
function assignBuses(routes: Route[]): number {
  const farBack = routes.filter((route) => route.type === "farBack");
  farBack.forEach((route, k) => {
    route.busY = MARGIN + k * BUS;
  });
  return farBack.length === 0 ? 0 : farBack.length * BUS + BUS_GAP;
}

/**
 * The one phase that positions the cards, in place: columns start at `topY`,
 * short columns are centred on the tallest, and every card is centred in
 * its column. Later phases read x/y through the same records.
 */
function stackColumns(
  columns: LaidOutNode[][],
  columnX: number[],
  columnWidth: number[],
  topY: number,
): void {
  const columnHeight = columns.map(
    (list) =>
      list.reduce((sum, node) => sum + node.height, 0) + Math.max(0, list.length - 1) * ROW_GAP,
  );
  const contentHeight = Math.max(0, ...columnHeight);
  columns.forEach((list, c) => {
    let y = topY + (contentHeight - (columnHeight[c] ?? 0)) / 2;
    for (const node of list) {
      node.x = (columnX[c] ?? 0) + ((columnWidth[c] ?? 0) - node.width) / 2;
      node.y = y;
      y += node.height + ROW_GAP;
    }
  });
}

/** Ports: spread along a face, ordered by where the other end sits. */
function assignPorts(routes: Route[], placed: Map<string, LaidOutNode>): void {
  const faces = new Map<string, Record<Face, Route[]>>(
    [...placed.keys()].map((id) => [id, { left: [], right: [] }]),
  );
  for (const route of routes) {
    const aFaces = faces.get(route.a.id);
    const bFaces = faces.get(route.b.id);
    if (!aFaces || !bFaces) continue;
    const ends = edgeFaces(route.type);
    aFaces[ends.a].push(route);
    bFaces[ends.b].push(route);
  }
  for (const node of placed.values()) {
    const nodeFaces = faces.get(node.id);
    if (!nodeFaces) continue;
    for (const list of [nodeFaces.left, nodeFaces.right]) {
      const otherY = (route: Route) => (route.a === node ? route.b : route.a).y;
      list.sort((p, q) => otherY(p) - otherY(q));
      list.forEach((route, i) => {
        const y = node.y + (node.height * (i + 1)) / (list.length + 1);
        if (route.a === node) route.ay = y;
        else route.by = y;
      });
    }
  }
}

/** Group frames around their members, with room for the label above them. */
function groupBoxes(
  groups: SystemDesignGroup[],
  placed: Map<string, LaidOutNode>,
  columnOf: Map<string, number>,
): GroupBox[] {
  return groups.flatMap((group, index) => {
    const members = group.nodes.flatMap((id) => {
      const member = placed.get(id);
      return member ? [member] : [];
    });
    if (members.length === 0) return [];
    const gx = Math.min(...members.map((m) => m.x)) - GROUP_PADDING;
    const gy = Math.min(...members.map((m) => m.y)) - GROUP_PADDING - GROUP_LABEL_PX;
    const right = Math.max(...members.map((m) => m.x + m.width)) + GROUP_PADDING;
    const bottom = Math.max(...members.map((m) => m.y + m.height)) + GROUP_PADDING;
    return [
      {
        box: {
          id: `group-${index}`,
          label: group.label,
          x: gx,
          y: gy,
          width: right - gx,
          height: bottom - gy,
        },
        columns: new Set(members.flatMap((m) => columnOf.get(m.id) ?? [])),
      },
    ];
  });
}

/** The vertical spans a line threaded through a column must avoid, sorted and merged. */
function blockedIntervals(cards: LaidOutNode[], labelBands: Interval[]): Interval[] {
  const intervals = [
    ...cards.map((node) => ({ start: node.y, end: node.y + node.height })),
    ...labelBands,
  ];
  intervals.sort((p, q) => p.start - q.start);
  const merged: Interval[] = [];
  for (const interval of intervals) {
    const last = merged[merged.length - 1];
    if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
    else merged.push({ ...interval });
  }
  return merged;
}

/** Where a line may cross a column: above every card, below every card, and each gap tall enough. */
function freeBands(blocked: Interval[], wanted: number): FreeBand[] {
  const first = blocked[0];
  const last = blocked[blocked.length - 1];
  if (!first || !last) {
    return [{ key: "open", side: "above", y: wanted, start: -Infinity, end: Infinity }];
  }
  const bands: FreeBand[] = [
    {
      key: "above",
      side: "above",
      y: Math.min(wanted, first.start - ROW_GAP / 2),
      start: -Infinity,
      end: first.start,
    },
    {
      key: "below",
      side: "below",
      y: Math.max(wanted, last.end + ROW_GAP / 2),
      start: last.end,
      end: Infinity,
    },
  ];
  blocked.slice(1).forEach((interval, i) => {
    const above = blocked[i];
    if (!above || interval.start - above.end < MIN_CROSSING_BAND) return;
    bands.push({
      key: `between-${i}`,
      side: "between",
      y: (above.end + interval.start) / 2,
      start: above.end,
      end: interval.start,
    });
  });
  return bands;
}

/** The band closest to where the straight line between the edge's ends would cross. */
function chooseBand(bands: FreeBand[], wanted: number): FreeBand | undefined {
  let best = bands[0];
  for (const band of bands) {
    if (best && Math.abs(band.y - wanted) < Math.abs(best.y - wanted)) best = band;
  }
  return best;
}

/**
 * Lines sharing a band fan out from each other: between cards they spread
 * around the middle of the gap; outside the cards each line keeps its own
 * height and only moves further out when another line would run too close.
 */
function fanOut(band: FreeBand, crossings: Crossing[]): void {
  if (band.side === "between") {
    crossings.sort((p, q) => p.wanted - q.wanted);
    const low = band.start + CROSSING_INSET;
    const high = band.end - CROSSING_INSET;
    crossings.forEach((crossing, i) => {
      const spread = band.y + (i - (crossings.length - 1) / 2) * CROSSING_STEP;
      crossing.y = Math.min(high, Math.max(low, spread));
    });
    return;
  }
  const outward = band.side === "above" ? -1 : 1;
  crossings.sort((p, q) => (p.y - q.y) * outward);
  crossings.forEach((crossing, i) => {
    const previous = crossings[i - 1];
    if (previous && (crossing.y - previous.y) * outward < CROSSING_STEP) {
      crossing.y = previous.y + CROSSING_STEP * outward;
    }
  });
}

/**
 * A skipping edge passes each intermediate column through the free band
 * closest to the straight line between its ends; the label band of a group
 * spanning the column is an obstacle like a card.
 */
function threadCrossings(routes: Route[], columns: LaidOutNode[][], groups: GroupBox[]): void {
  const labelBands = (column: number): Interval[] =>
    groups
      .filter((group) => group.columns.has(column))
      .map((group) => ({
        start: group.box.y,
        end: group.box.y + GROUP_LABEL_PX + GROUP_PADDING,
      }));
  const bandUse = new Map<string, { band: FreeBand; crossings: Crossing[] }>();
  for (const route of routes) {
    if (route.type !== "skip") continue;
    for (let column = route.aCol + 1; column < route.bCol; column++) {
      const t = (column - route.aCol) / (route.bCol - route.aCol);
      const wanted = route.ay + (route.by - route.ay) * t;
      const blocked = blockedIntervals(columns[column] ?? [], labelBands(column));
      const best = chooseBand(freeBands(blocked, wanted), wanted);
      if (!best) continue;
      const key = `${column}:${best.key}`;
      const users = bandUse.get(key) ?? { band: best, crossings: [] };
      const crossing: Crossing = { band: key, wanted, y: best.y };
      users.crossings.push(crossing);
      bandUse.set(key, users);
      route.crossings.push(crossing);
    }
  }
  for (const { band, crossings } of bandUse.values()) fanOut(band, crossings);
}

/** The polyline and label anchor of every edge. */
function toRoutedEdges(routes: Route[], laneX: (lane: Lane) => number): RoutedEdge[] {
  return routes.map((route) => {
    const leftward = route.type === "back" || route.type === "farBack";
    return {
      id: route.id,
      from: route.from,
      to: route.to,
      label: route.label,
      async: route.async,
      points: routePoints(route, laneX),
      labelX: leftward ? route.a.x - LABEL_OFFSET_X : route.a.x + route.a.width + LABEL_OFFSET_X,
      labelY: route.ay,
      labelAnchor: leftward ? "end" : "start",
    };
  });
}

/**
 * The phases in dependency order: ports need the cards' y, crossings need
 * the ports, group frames need the cards' x/y — so the order is load-bearing.
 */
export function layoutSystemDesign(design: SystemDesign): SystemDesignLayout {
  const columnOf = new Map(design.NODES.map((node) => [node.id, node.col]));
  const classified = classifyEdges(design.EDGES, columnOf);
  const { placed, columns } = sizeCards(design.NODES, portLoad(design.NODES, classified));
  const { routes, corridors } = assignLanes(classified, placed);
  const { columnX, columnWidth, laneX } = horizontalGeometry(columns, corridors);
  stackColumns(columns, columnX, columnWidth, MARGIN + assignBuses(routes));
  assignPorts(routes, placed);
  const groups = groupBoxes(design.GROUPS, placed, columnOf);
  threadCrossings(routes, columns, groups);
  return padded({
    nodes: [...placed.values()],
    groups: groups.map((group) => group.box),
    edges: toRoutedEdges(routes, laneX),
  });
}

/**
 * Measures everything the diagram draws (cards, group frames, edge lines and
 * labels), moves it so nothing sits closer than the margin to the top-left
 * corner, and sizes the canvas to the far edge plus the same margin. Works
 * in place: only freshly built records reach it, so copying would buy nothing.
 */
function padded(layout: Omit<SystemDesignLayout, "width" | "height">): SystemDesignLayout {
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
  const dx = MARGIN - Math.min(MARGIN, ...xs);
  const dy = MARGIN - Math.min(MARGIN, ...ys);
  for (const box of [...layout.nodes, ...layout.groups]) {
    box.x += dx;
    box.y += dy;
  }
  for (const edge of layout.edges) {
    for (const point of edge.points) {
      point.x += dx;
      point.y += dy;
    }
    edge.labelX += dx;
    edge.labelY += dy;
  }
  return {
    ...layout,
    width: Math.max(...xs) + dx + MARGIN,
    height: Math.max(...ys) + dy + MARGIN,
  };
}

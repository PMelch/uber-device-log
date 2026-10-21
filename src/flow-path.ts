/** Card summary: observed steps plus the immediate expected steps. Later steps stay behind an ellipsis. */
export function flowSummary<T extends { id: string }>(steps: T[], observed: ReadonlySet<string>, expected: readonly string[]) {
  const shown = steps.filter(step => observed.has(step.id) || expected.includes(step.id));
  return { shown, continues: shown.length < steps.length };
}

/** When several steps are expected at once, they leave the trunk and become fork lanes. */
export function cardFork<T extends { id: string }>(shown: readonly T[], expected: readonly T[]) {
  const lanes = expected.length > 1 ? [...expected] : [];
  const ids = new Set(lanes.map(step => step.id));
  return { trunk: lanes.length > 1 ? shown.filter(step => !ids.has(step.id)) : [...shown], lanes, branching: lanes.length > 1 };
}

/** Accent the edge that was just taken, or the edge from the latest step to what is expected now. */
export function flowEdgeTone(observations: readonly { stepId: string; accepted?: boolean }[], expected: readonly string[], from: string, to: string) {
  const seen: string[] = [];
  for (const item of observations) if (item.accepted !== false && seen.at(-1) !== item.stepId) seen.push(item.stepId);
  if (seen.at(-1) === from && expected.includes(to)) return 'is-live';
  const index = seen.lastIndexOf(from);
  return index >= 0 && seen[index + 1] === to ? 'is-live' : '';
}

/** Rounded split from the trunk into one curve per lane. */
export function forkConnectors(count: number, width = 48, pitch = 74) {
  const height = Math.max(pitch, count * pitch);
  const startY = pitch / 2;
  const paths = Array.from({ length: count }, (_, index) => {
    const y = (index + 0.5) * (height / count);
    return `M 2 ${startY} C ${width * 0.66} ${startY}, ${width * 0.34} ${y}, ${width - 2} ${y}`;
  });
  return { width, height, startY, paths };
}

export interface FlowGraphLayout {
  width: number;
  height: number;
  nodes: { id: string; x: number; y: number; rank: number; lane: number }[];
  edges: { from: string; to: string; d: string }[];
}

const COLUMN = 188;
const RANK = 84;
const NODE_W = 168;
const NODE_H = 72;

/** Vertical layered graph. A fork shares a rank and spreads across lanes; edges are rounded. */
export function layoutFlowGraph(steps: readonly { id: string; next?: readonly string[] }[]): FlowGraphLayout {
  const byId = new Map(steps.map(step => [step.id, step]));
  const rank = new Map(steps.map(step => [step.id, 0]));
  const pending = new Map(steps.map(step => [step.id, 0]));
  for (const step of steps) for (const next of step.next ?? []) if (pending.has(next)) pending.set(next, (pending.get(next) ?? 0) + 1);
  const queue = steps.filter(step => pending.get(step.id) === 0).map(step => step.id);
  const topo: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    topo.push(id);
    for (const next of byId.get(id)?.next ?? []) {
      if (!rank.has(next)) continue;
      rank.set(next, Math.max(rank.get(next) ?? 0, (rank.get(id) ?? 0) + 1));
      pending.set(next, (pending.get(next) ?? 1) - 1);
      if (pending.get(next) === 0) queue.push(next);
    }
  }
  for (const step of steps) if (!topo.includes(step.id)) topo.push(step.id);
  const parents = new Map<string, string[]>();
  for (const step of steps) for (const next of step.next ?? []) {
    const list = parents.get(next) ?? [];
    list.push(step.id);
    parents.set(next, list);
  }
  const lane = new Map<string, number>();
  const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const levels = [...new Set(topo.map(id => rank.get(id) ?? 0))].sort((a, b) => a - b);
  for (const level of levels) {
    const row = topo.filter(id => (rank.get(id) ?? 0) === level);
    const preferred = new Map(row.map(id => {
      const incoming = parents.get(id) ?? [];
      if (!incoming.length) return [id, row.filter(other => !(parents.get(other)?.length)).indexOf(id)] as const;
      return [id, mean(incoming.map(parent => (lane.get(parent) ?? 0) + Math.max((byId.get(parent)?.next ?? []).indexOf(id), 0)))] as const;
    }));
    row.sort((a, b) => (preferred.get(a) ?? 0) - (preferred.get(b) ?? 0) || topo.indexOf(a) - topo.indexOf(b));
    const used = new Set<number>();
    for (const id of row) {
      let spot = Math.round(preferred.get(id) ?? 0);
      while (used.has(spot)) spot += 1;
      used.add(spot);
      lane.set(id, spot);
    }
  }
  const maxLane = Math.max(0, ...lane.values(), 0);
  const maxRank = Math.max(0, ...rank.values(), 0);
  const nodes = topo.map(id => ({ id, rank: rank.get(id) ?? 0, lane: lane.get(id) ?? 0, x: 8 + (lane.get(id) ?? 0) * COLUMN, y: 8 + (rank.get(id) ?? 0) * RANK }));
  const at = new Map(nodes.map(node => [node.id, node]));
  let width = 16 + (maxLane + 1) * COLUMN;
  const edges = steps.flatMap(step => (step.next ?? []).filter(next => at.has(next)).map(next => {
    const from = at.get(step.id)!;
    const to = at.get(next)!;
    const routed = routeEdge(from, to, nodes);
    width = Math.max(width, routed.extent);
    return { from: step.id, to: next, d: routed.d };
  }));
  return { width, height: 16 + (maxRank + 1) * RANK, nodes, edges };
}

/** A long edge drops below any step it would cross, then turns on a rounded corner. */
function routeEdge(from: FlowGraphLayout['nodes'][number], to: FlowGraphLayout['nodes'][number], nodes: FlowGraphLayout['nodes']) {
  const x1 = from.x + 16;
  const y1 = from.y + 33;
  const x2 = to.x + 16;
  const y2 = to.y;
  const bend = Math.max(16, (y2 - y1) / 2);
  const direct = `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2}`;
  const others = nodes.filter(node => node.id !== from.id && node.id !== to.id);
  const hits = (d: string) => curvePoints(d).some(point => others.some(node => point.x >= node.x && point.x <= node.x + NODE_W && point.y >= node.y && point.y <= node.y + NODE_H));
  if (!hits(direct)) return { d: direct, extent: Math.max(x1, x2) + 8 };
  const yChannel = Math.max(y1 + 12, ...others.map(node => node.y + NODE_H + 2));
  if (yChannel < y2 - 2) {
    const channel = roundedRoute([[x1, y1], [x1, yChannel], [x2, yChannel], [x2, y2]]);
    if (!hits(channel)) return { d: channel, extent: Math.max(x1, x2) + 8 };
  }
  const yLeave = from.y + NODE_H + 6;
  if (yLeave < y2 - 2) {
    const dogleg = roundedRoute([[x1, y1], [x1, yLeave], [x2, yLeave], [x2, y2]]);
    if (!hits(dogleg)) return { d: dogleg, extent: Math.max(x1, x2) + 8 };
  }
  let gutter = Math.max(...nodes.map(node => node.x + NODE_W)) + 20;
  let chosen = direct;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const yLeave = from.y + NODE_H + 6;
    const yEnter = Math.max(yLeave, y2 - 6);
    chosen = roundedRoute([[x1, y1], [x1, yLeave], [gutter, yLeave], [gutter, yEnter], [x2, yEnter], [x2, y2]]);
    if (!hits(chosen)) return { d: chosen, extent: gutter + 16 };
    gutter += 40;
  }
  return { d: chosen, extent: gutter + 16 };
}

/** Round orthogonal detours without changing the reserved channels between node boxes. */
function roundedRoute(points: [number, number][]) {
  const route = points.filter((point, index) => !index || point[0] !== points[index - 1][0] || point[1] !== points[index - 1][1]);
  let d = `M ${route[0][0]} ${route[0][1]}`;
  for (let index = 1; index < route.length - 1; index++) {
    const previous = route[index - 1], corner = route[index], next = route[index + 1];
    const before = Math.hypot(corner[0] - previous[0], corner[1] - previous[1]);
    const after = Math.hypot(next[0] - corner[0], next[1] - corner[1]);
    const radius = Math.min(12, before / 2, after / 2);
    const entry = corner.map((value, axis) => value + (previous[axis] - value) * radius / before);
    const exit = corner.map((value, axis) => value + (next[axis] - value) * radius / after);
    d += ` L ${entry[0]} ${entry[1]} C ${corner[0]} ${corner[1]}, ${corner[0]} ${corner[1]}, ${exit[0]} ${exit[1]}`;
  }
  const end = route.at(-1)!;
  return `${d} L ${end[0]} ${end[1]}`;
}

function curvePoints(d: string) {
  const tokens = d.match(/[MLC]|-?\d+(?:\.\d+)?/g) ?? [];
  const points: { x: number; y: number }[] = [];
  let index = 0;
  let cursor = { x: 0, y: 0 };
  const number = () => Number(tokens[index++]);
  while (index < tokens.length) {
    const command = tokens[index++];
    if (command === 'M' || command === 'L') {
      const next = { x: number(), y: number() };
      if (command === 'L') {
        for (let step = 1; step <= 16; step += 1) {
          const t = step / 16;
          points.push({ x: cursor.x + (next.x - cursor.x) * t, y: cursor.y + (next.y - cursor.y) * t });
        }
      } else points.push(next);
      cursor = next;
    } else if (command === 'C') {
      const start = cursor;
      const c1 = { x: number(), y: number() };
      const c2 = { x: number(), y: number() };
      const end = { x: number(), y: number() };
      for (let step = 1; step <= 16; step += 1) {
        const t = step / 16;
        const u = 1 - t;
        points.push({
          x: u * u * u * start.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * end.x,
          y: u * u * u * start.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * end.y,
        });
      }
      cursor = end;
    }
  }
  return points;
}

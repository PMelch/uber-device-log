import test from 'node:test';
import assert from 'node:assert/strict';
import { cardFork, flowEdgeTone, flowSummary, forkConnectors, layoutFlowGraph } from '../src/flow-path';

test('flow summary keeps observed steps and every immediate expected step, then stops', () => {
  const steps = ['start', 'store', 'started', 'success', 'cancel', 'verify', 'consumed'].map(id => ({ id }));
  const summary = flowSummary(steps, new Set(['start', 'store', 'started']), ['success', 'cancel']);
  assert.deepEqual(summary.shown.map(step => step.id), ['start', 'store', 'started', 'success', 'cancel']);
  assert.equal(summary.continues, true);
});

test('a finished route does not imply later steps', () => {
  const steps = ['start', 'done'].map(id => ({ id }));
  const summary = flowSummary(steps, new Set(['start', 'done']), []);
  assert.deepEqual(summary.shown.map(step => step.id), ['start', 'done']);
  assert.equal(summary.continues, false);
});

test('two expected steps become fork lanes and leave the trunk linear', () => {
  const shown = ['start', 'store', 'success', 'cancel'].map(id => ({ id }));
  const fork = cardFork(shown, shown.filter(step => step.id === 'success' || step.id === 'cancel'));
  assert.equal(fork.branching, true);
  assert.deepEqual(fork.trunk.map(step => step.id), ['start', 'store']);
  assert.deepEqual(fork.lanes.map(step => step.id), ['success', 'cancel']);
  const connectors = forkConnectors(2);
  assert.equal(connectors.paths.length, 2);
  assert.ok(connectors.paths.every(path => path.includes('C')));
});

test('a blueprint fork shares a rank and a join meets again', () => {
  const layout = layoutFlowGraph([
    { id: 'start', next: ['pay', 'cancel'] },
    { id: 'pay', next: ['done'] },
    { id: 'cancel', next: ['done'] },
    { id: 'done' },
  ]);
  const at = (id: string) => layout.nodes.find(node => node.id === id)!;
  assert.equal(at('pay').rank, at('cancel').rank);
  assert.notEqual(at('pay').lane, at('cancel').lane);
  assert.equal(at('done').rank, at('pay').rank + 1);
  assert.equal(layout.edges.length, 4);
  assert.ok(layout.edges.every(edge => edge.d.includes('C')));
});

test('a branch that also continues keeps the alternatives in different columns', () => {
  const layout = layoutFlowGraph([
    { id: 'receipt', next: ['receipt_debug', 'submit'] },
    { id: 'receipt_debug', next: ['submit'] },
    { id: 'submit' },
  ]);
  const at = (id: string) => layout.nodes.find(node => node.id === id)!;
  assert.notEqual(at('receipt_debug').lane, at('submit').lane);
  assert.ok(at('submit').rank > at('receipt_debug').rank);
});

test('a taken optional step leaves the bypass unaccented', () => {
  const waiting = [{ stepId: 'receipt', accepted: true }];
  assert.equal(flowEdgeTone(waiting, ['receipt_debug', 'submit'], 'receipt', 'receipt_debug'), 'is-live');
  assert.equal(flowEdgeTone(waiting, ['receipt_debug', 'submit'], 'receipt', 'submit'), 'is-live');
  const taken = [...waiting, { stepId: 'receipt_debug', accepted: true }];
  assert.equal(flowEdgeTone(taken, ['submit'], 'receipt', 'receipt_debug'), 'is-live');
  assert.equal(flowEdgeTone(taken, ['submit'], 'receipt_debug', 'submit'), 'is-live');
  assert.equal(flowEdgeTone(taken, ['submit'], 'receipt', 'submit'), '');
  const finished = [...taken, { stepId: 'submit', accepted: true }];
  assert.equal(flowEdgeTone(finished, [], 'receipt_debug', 'submit'), 'is-live');
  assert.equal(flowEdgeTone(finished, [], 'receipt', 'submit'), '');
});

test('an optional expected step still opens its own fork lane', () => {
  const receipt = { id: 'receipt' };
  const debug = { id: 'receipt_debug' };
  const submit = { id: 'submit' };
  const fork = cardFork([receipt, submit], [debug, submit]);
  assert.equal(fork.branching, true);
  assert.deepEqual(fork.trunk.map(step => step.id), ['receipt']);
  assert.deepEqual(fork.lanes.map(step => step.id), ['receipt_debug', 'submit']);
});

function curveSamples(d: string) {
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

test('a bypass edge stays outside the sibling step', () => {
  const purchase = [
    { id: 'backend_init', next: ['backend_ready'] },
    { id: 'backend_ready', next: ['store_ios', 'store_android'] },
    { id: 'store_ios', next: ['receipt'] },
    { id: 'store_android', next: ['receipt'] },
    { id: 'receipt', next: ['receipt_debug', 'submit'] },
    { id: 'receipt_debug', next: ['submit'] },
    { id: 'submit', next: ['confirmed'] },
    { id: 'confirmed', next: ['balance'] },
    { id: 'balance' },
  ];
  const download = [
    { id: 'requested', next: ['received'] },
    { id: 'received', next: ['verified', 'ready'] },
    { id: 'verified', next: ['ready'] },
    { id: 'ready' },
  ];
  const beside = [
    { id: 'store', next: ['ios', 'android'] },
    { id: 'ios', next: ['receipt'] },
    { id: 'android', next: ['debug', 'receipt'] },
    { id: 'debug', next: ['receipt'] },
    { id: 'receipt' },
  ];
  const join = [
    { id: 'a', next: ['join'] },
    { id: 'b', next: ['join'] },
    { id: 'c', next: ['join'] },
    { id: 'join' },
  ];
  const skip = [
    { id: 'start', next: ['a', 'b', 'c'] },
    { id: 'a', next: ['a2', 'join'] },
    { id: 'b', next: ['join'] },
    { id: 'c', next: ['c2'] },
    { id: 'a2', next: ['join'] },
    { id: 'c2', next: ['join'] },
    { id: 'join' },
  ];
  for (const steps of [purchase, download, beside, join, skip]) {
    const layout = layoutFlowGraph(steps);
    for (const edge of layout.edges) {
      for (const point of curveSamples(edge.d)) {
        for (const node of layout.nodes) {
          if (node.id === edge.from || node.id === edge.to) continue;
          const hit = point.x >= node.x && point.x <= node.x + 168 && point.y >= node.y && point.y <= node.y + 72;
          assert.equal(hit, false, `${edge.from}->${edge.to} crosses ${node.id}`);
        }
      }
    }
  }
});


test('forks keep a straight first lane and round into every additional configured path', () => {
  for (const count of [2, 3, 4, 8]) {
    const steps = Array.from({ length: count }, (_, i) => ({ id: `branch-${i}` }));
    const fork = cardFork([{ id: 'start' }, ...steps], steps);
    assert.equal(fork.lanes.length, count);
    const connectors = forkConnectors(count, 48, 96);
    assert.equal(connectors.paths.length, count);
    for (let index = 0; index < count; index++) {
      const points = curveSamples(connectors.paths[index]);
      assert.deepEqual(points[0], { x: 2, y: 48 });
      assert.deepEqual(points.at(-1), { x: 46, y: 48 + index * 96 });
      if (index === 0) assert.ok(points.every(point => Math.abs(point.y - 48) < 0.001));
    }
    const graph = layoutFlowGraph([
      { id: 'start', next: steps.map(step => step.id) },
      ...steps.map(step => ({ ...step, next: ['join'] })),
      { id: 'join' },
    ]);
    const branches = graph.nodes.filter(node => node.id.startsWith('branch-'));
    assert.equal(new Set(branches.map(node => node.lane)).size, count);
    assert.equal(new Set(branches.map(node => node.rank)).size, 1);
    assert.equal(graph.edges.length, count * 2);
    for (const edge of graph.edges) for (const point of curveSamples(edge.d)) {
      for (const node of graph.nodes.filter(node => node.id !== edge.from && node.id !== edge.to)) {
        assert.equal(point.x >= node.x && point.x <= node.x + 168 && point.y >= node.y && point.y <= node.y + 72, false, `${count} paths: ${edge.from}->${edge.to} crosses ${node.id}`);
      }
    }
  }
});

test('join detours use rounded corners with nonzero entry and exit tangents', () => {
  const layout = layoutFlowGraph([
    { id: 'start', next: ['a', 'b', 'c', 'd'] },
    ...['a', 'b', 'c', 'd'].map(id => ({ id, next: ['done'] })),
    { id: 'done' },
  ]);
  for (const edge of layout.edges) {
    for (const match of edge.d.matchAll(/C ([\d.]+) ([\d.]+), ([\d.]+) ([\d.]+), ([\d.]+) ([\d.]+)/g)) {
      assert.ok(match[3] !== match[5] || match[4] !== match[6], `${edge.from}->${edge.to} stops at a sharp corner`);
    }
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { parseFlowBlueprint } from '../shared/flow-blueprints';

test('a maximum-size dense DAG renders with bounded graph reads after a long bypass', async () => {
  const count = 100;
  const value = { version: 1, id: 'dense', name: 'Dense graph', start: 's0', timeout: '1h', correlation: { scope: 'device-session', primary: 'id' }, steps: Array.from({ length: count }, (_, i) => ({ id: `s${i}`, name: `Step ${i}`, match: { json: { path: 'event', equals: `step.${i}` } }, ...(i === 0 ? { extract: { id: { json: 'id', required: true } } } : {}), ...(i === count - 1 ? { outcome: 'completed' } : { next: Array.from({ length: count - i - 1 }, (_, j) => `s${i + j + 1}`) }) })) };
  const parsed = parseFlowBlueprint(JSON.stringify(value));
  assert.deepEqual(parsed.diagnostics, []);
  const blueprint = parsed.blueprint!;
  let reads = 0;
  for (const step of blueprint.steps) {
    const next = step.next;
    Object.defineProperty(step, 'next', { get() { assert.ok(++reads <= 5000, 'graph adjacency must be shared across step-state and card computations'); return next; } });
  }
  const instance = { id: 'dense-1', blueprint, revision: 'r1', outcome: 'running', completeness: 'complete', expected: ['s99'], deviceId: 'phone', startedAt: 0, updatedAt: 1, timeoutAt: 3600000, bindings: { id: 'a' }, observations: [{ stepId: 's0', payload: { id: 'a' } }, { stepId: 's98', payload: {} }] };
  const server = await createServer({ server: { middlewareMode: true, watch: null, ws: false } });
  try {
    const { default: Workspace } = await server.ssrLoadModule('/src/components/FlowWorkspace.vue');
    const html = await renderToString(createSSRApp({ render: () => h(Workspace, { snapshot: { enabled: true, files: [], blueprints: [blueprint], diagnostics: [], revision: 'r1' }, instances: [instance], loading: false, activeSources: 1, gapCount: 0, locale: 'en' }) }));
    assert.match(html, /Step 98/);
    assert.match(html, /Step 99/);
    assert.ok(reads < 2000, `${reads} adjacency reads for one legal 100-node card`);
  } finally { await server.close(); }
});

test('shared route state preserves nested alternatives, joins and an active repeatable phase', async () => {
  const { flowRouteTopology, flowRouteStates } = await import('../src/flow-path');
  const graph = flowRouteTopology([
    { id: 'start', next: ['progress', 'cancel'] },
    { id: 'progress', next: ['approve', 'reject'] },
    { id: 'approve', next: ['done'] },
    { id: 'reject', next: ['done'] },
    { id: 'cancel' },
    { id: 'done' },
  ]);
  const phase = flowRouteStates(graph, new Set(['start', 'progress']), ['progress', 'approve', 'reject']);
  assert.equal(phase.get('progress'), 'observed');
  assert.equal(phase.get('approve'), 'expected');
  assert.equal(phase.get('reject'), 'expected');
  assert.equal(phase.get('cancel'), 'other');
  assert.equal(phase.get('done'), 'missing', 'a shared join remains on both routes');
  const completed = flowRouteStates(graph, new Set(['start', 'progress', 'approve', 'done']), []);
  assert.equal(completed.get('reject'), 'other');
  assert.equal(completed.get('done'), 'observed');
  assert.equal(completed.get('cancel'), 'other');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import { parseFlowBlueprint } from '../shared/flow-blueprints.js';
import { createFlowEngine } from '../shared/flow-engine.js';
import { flowPresentation } from '../shared/flow-presentation.js';

async function blueprint() {
  const parsed = parseFlowBlueprint(await readFile(new URL('../test_flow_project/.udl/flows/loading-progress.yaml', import.meta.url), 'utf8'), 'loading-progress.yaml');
  assert.deepEqual(parsed.diagnostics, []);
  return parsed.blueprint!;
}

test('loading sample updates one repeatable phase, accepts backward progress, supports zero updates, and preserves terminal labels', async () => {
  let clock = 1000;
  const engine = createFlowEngine(() => clock);
  engine.setBlueprints([await blueprint()], 'loading-fixture');
  const events = (await readFile(new URL('../test_flow_project/loading-progress-events.jsonl', import.meta.url), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const updates: number[] = [];
  for (const event of events) {
    engine.ingest([{ timestamp: new Date(clock).toISOString(), message: JSON.stringify(event) }]);
    clock += 100;
    if (event.loadId === 'loading-success' && event.event === 'loading.progress' && event.percent !== 999) {
      const instance = engine.getState().instances.find(value => value.bindings.loadId === event.loadId)!;
      assert.equal(instance.outcome, 'running');
      assert.equal(flowPresentation(instance).label.map(part => part.text).join(''), `Loading ${event.percent}%`);
      assert.equal(flowPresentation(instance).results.find(value => value.field === 'percent')?.value, event.percent);
      updates.push(event.percent);
    }
  }
  const find = (id: string) => engine.getState().instances.find(value => value.bindings.loadId === id)!;
  assert.deepEqual(updates, [0, 50, 40, 100]);
  assert.equal(find('loading-success').outcome, 'completed');
  assert.equal(find('loading-success').observations.filter(value => value.stepId === 'progress' && value.accepted !== false).length, 4);
  assert.equal(flowPresentation(find('loading-success')).label.map(part => part.text).join(''), 'Loading completed');
  assert.equal(flowPresentation(find('loading-success')).results.find(value => value.field === 'percent')?.value, 100);
  assert.equal(find('loading-zero').outcome, 'completed');
  assert.equal(find('loading-zero').observations.some(value => value.stepId === 'progress'), false);
  assert.equal(find('loading-error').errorCode, 'LOAD_FAILED');
  assert.equal(find('loading-cancelled').outcome, 'cancelled');
  clock += 31000; engine.tick();
  assert.equal(find('loading-timeout').outcome, 'timed_out');
  assert.equal(find('loading-timeout').errorCode, undefined);
  assert.equal(engine.getState().instances.length, 5, 'late progress must not create a standalone orphan instance');
});

test('loading demo emits fresh correlated IDs and matching progress, error, cancel and zero-update routes without network APIs', async () => {
  const html = await readFile(new URL('../test_flow_project/loading-progress-demo.html', import.meta.url), 'utf8');
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1]!;
  const events: Record<string, unknown>[] = [];
  let serial = 0;
  const output = { textContent: '', scrollTop: 0, scrollHeight: 10 };
  const context = createContext({ document: { querySelector: () => output, querySelectorAll: () => [] }, console: { log: (line: string) => events.push(JSON.parse(line)) }, crypto: { randomUUID: () => `fixture-${++serial}` }, setTimeout: (callback: () => void) => { callback(); return 0; } });
  runInContext(script, context);
  for (const route of ['success', 'backward', 'zero', 'error', 'cancelled', 'timeout']) await runInContext(`run(${JSON.stringify(route)})`, context);
  assert.equal(new Set(events.filter(value => value.event === 'loading.started').map(value => value.loadId)).size, 6);
  const engine = createFlowEngine(() => 1000);
  engine.setBlueprints([await blueprint()], 'emitter');
  for (const event of events) engine.ingest([{ timestamp: new Date(1000).toISOString(), message: JSON.stringify(event) }]);
  assert.equal(engine.getState().instances.filter(value => value.outcome === 'completed').length, 3);
  assert.equal(engine.getState().instances.filter(value => value.outcome === 'failed').length, 1);
  assert.equal(engine.getState().instances.filter(value => value.outcome === 'cancelled').length, 1);
  assert.equal(engine.getState().instances.filter(value => value.outcome === 'running').length, 1);
});

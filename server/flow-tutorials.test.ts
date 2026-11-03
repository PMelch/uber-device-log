import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { FlowProject } from './flow-project.js';
import { createFlowEngine } from '../shared/flow-engine.js';
import { parseFlowBlueprint } from '../shared/flow-blueprints.js';

const root = new URL('../tutorials/semantic-flows/', import.meta.url);
const chapters = ['single-event', 'multipart', 'branching'] as const;
function read(relative: string) {
  const path = new URL(relative, root);
  assert.ok(existsSync(path), `Missing tutorial asset: ${relative}`);
  return readFileSync(path, 'utf8');
}
function replay(chapter: typeof chapters[number]) {
  const source = read(`.udl/flows/${chapter}.yaml`);
  const parsed = parseFlowBlueprint(source, `${chapter}.yaml`);
  assert.deepEqual(parsed.diagnostics, []);
  const markdown = read(`${chapter}/README.md`);
  assert.equal(markdown.match(/```yaml\n([\s\S]*?)\n```/)?.[1], source.trim(), 'copyable README must match the executable YAML');
  const events = read(`${chapter}/events.jsonl`).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(markdown.match(/```jsonl\n([\s\S]*?)\n```/)?.[1], read(`${chapter}/events.jsonl`).trim());
  let clock = 1000;
  const engine = createFlowEngine(() => clock);
  engine.setBlueprints([parsed.blueprint!], 'tutorial');
  for (const event of events) {
    engine.ingest([{ timestamp: new Date(clock).toISOString(), message: JSON.stringify(event), source: { key: 'tutorial', name: 'Tutorial', platform: 'android', deviceId: 'phone' } }]);
    clock += 100;
  }
  return { engine, advance: () => { clock += 31_000; engine.tick(); } };
}

test('tutorial project activates all three beginner blueprints without diagnostics', async () => {
  read('README.md');
  const project = await FlowProject.create(fileURLToPath(root));
  const snapshot = await project.reload();
  assert.deepEqual(snapshot.diagnostics, []);
  assert.deepEqual(snapshot.blueprints.map(item => item.id).sort(), chapters.map(chapter => `tutorial-${chapter}`).sort());
});

test('single-event tutorial needs no operation ID and each repeated event completes independently', () => {
  const { engine } = replay('single-event');
  const instances = engine.getState().instances;
  assert.equal(instances.length, 2);
  assert.equal(new Set(instances.map(item => item.id)).size, 2);
  for (const item of instances) {
    assert.equal(item.outcome, 'completed');
    assert.equal(item.completeness, 'complete');
    assert.equal(item.observations.length, 1);
    assert.equal(item.bindings.event, 'app.ready');
  }
});

test('multipart tutorial keeps interleaved operations separate and times out missing completion', () => {
  const { engine, advance } = replay('multipart');
  let instances = engine.getState().instances;
  assert.equal(instances.length, 3);
  for (const id of ['sync-1', 'sync-2']) {
    const item = instances.find(item => item.bindings.requestId === id)!;
    assert.equal(item.outcome, 'completed');
    assert.equal(item.completeness, 'complete');
    assert.deepEqual(item.observations.map(row => row.stepId), ['start', 'received', 'done']);
    assert.ok(item.observations.every(row => JSON.parse(row.message.message).requestId === id));
  }
  assert.equal(instances.find(item => item.bindings.requestId === 'sync-3')?.outcome, 'running');
  advance();
  instances = engine.getState().instances;
  assert.equal(instances.find(item => item.bindings.requestId === 'sync-3')?.outcome, 'timed_out');
});

test('branching tutorial completes either route without requiring the unchosen sibling', () => {
  const { engine } = replay('branching');
  const instances = engine.getState().instances;
  assert.equal(instances.length, 2);
  for (const [id, step, outcome] of [['order-1', 'accepted', 'completed'], ['order-2', 'rejected', 'failed']]) {
    const item = instances.find(item => item.bindings.requestId === id)!;
    assert.equal(item.outcome, outcome);
    assert.equal(item.completeness, 'complete');
    assert.deepEqual(item.observations.map(row => row.stepId), ['start', step]);
    assert.ok(item.observations.every(row => JSON.parse(row.message.message).requestId === id));
  }
});


test('copyable tutorial emitters produce the documented JSONL messages', () => {
  for (const chapter of chapters) {
    const source = read(`${chapter}/README.md`).match(/```js\n([\s\S]*?)\n```/)?.[1];
    assert.ok(source, `Missing emitter for ${chapter}`);
    const emitted: unknown[] = [];
    runInNewContext(source, {
      crypto: { randomUUID: () => chapter === 'multipart' ? 'sync' : 'order' },
      console: { log: (record: string) => emitted.push(JSON.parse(record)) },
    }, { timeout: 1000 });
    assert.deepEqual(emitted, read(`${chapter}/events.jsonl`).trim().split('\n').map(line => JSON.parse(line)));
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseFlowBlueprint } from '../shared/flow-blueprints.js';
import { createFlowEngine } from '../shared/flow-engine.js';

const document = new URL('../docs/flow-format.md', import.meta.url);
async function examples() {
  const markdown = await readFile(document, 'utf8');
  const sources = [...markdown.matchAll(/```yaml\n([\s\S]*?)\n```/g)].map(match => match[1]).filter(source => /^version: 1$/m.test(source));
  assert.equal(sources.length, 4, 'all four complete reference examples are validated');
  return sources.map(source => {
    const parsed = parseFlowBlueprint(source, 'reference.yaml');
    assert.deepEqual(parsed.diagnostics, []);
    return parsed.blueprint!;
  });
}

test('format reference examples validate and recognize their documented routes', async () => {
  const definitions = await examples();
  function replay(id: string, events: (string | Record<string, unknown>)[]) {
    const engine = createFlowEngine(() => 1000);
    engine.setBlueprints([definitions.find(blueprint => blueprint.id === id)!], 'docs');
    engine.ingest(events.map(event => ({ timestamp: '2026-10-21T10:00:00Z', message: typeof event === 'string' ? event : JSON.stringify(event), source: { key: 'phone', name: 'Phone', platform: 'android' as const, deviceId: 'test-phone' } })));
    return engine.getState().instances;
  }
  assert.equal(replay('hello', [{event:'hello.started',requestId:'r1'},{event:'hello.completed',requestId:'r1'}])[0].outcome, 'completed');
  for (const route of ['card', 'wallet', 'voucher']) {
    for (const audit of [false, true]) {
      const events = [{event:'checkout.started',requestId:'r1'},{event:`checkout.${route}`,requestId:'r1'}, ...(audit ? [{event:'checkout.audit',requestId:'r1'}] : []), {event:'checkout.completed',requestId:'r1'}];
      const instance = replay('checkout', events)[0];
      assert.equal(instance.outcome, 'completed');
      assert.equal(instance.completeness, 'complete');
      assert.deepEqual(instance.observations.map(row => row.stepId), ['start',route,...(audit ? ['audit'] : []),'done']);
    }
  }
  const started = [{event:'job.started',requestId:'r1'}, {event:'job.accepted',requestId:'r1',jobId:'j1',token:'private'}];
  assert.equal(replay('job', [...started,{event:'job.submitted',jobId:'j1'},{event:'job.completed',jobId:'j1'}])[0].outcome, 'completed');
  for (const [code, outcome] of [['USER_CANCELLED','cancelled'], ['FAILED','failed'], ['NEW_CODE','failed']]) {
    const instance = replay('job', [...started,{event:'job.error',jobId:'j1',code}])[0];
    assert.equal(instance.outcome, outcome);
    assert.equal(instance.errorCode, code);
  }
  const concurrent = replay('job', [
    ...started, {event:'job.started',requestId:'r2'}, {event:'job.accepted',requestId:'r2',jobId:'j2'},
    {event:'job.submitted',jobId:'j2'}, {event:'job.submitted',jobId:'j1'},
    {event:'job.completed',jobId:'j1'}, {event:'job.completed',jobId:'j2'},
  ]);
  assert.equal(concurrent.length, 2);
  assert.ok(concurrent.every(instance => instance.outcome === 'completed' && instance.completeness === 'complete'));
  assert.equal(replay('text-job', ['job.start request=r1', 'job.done request=r1'])[0].outcome, 'completed');
});

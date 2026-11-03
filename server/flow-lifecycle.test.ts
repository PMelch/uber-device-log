import test from 'node:test';
import assert from 'node:assert/strict';
import { createFlowEngine } from '../shared/flow-engine.js';
import { parseFlowBlueprint } from '../shared/flow-blueprints.js';
import type { FlowBlueprint } from '../shared/flow-types.js';
import type { LogMessage } from '../shared/types.js';

const identity = { id: { json: 'id', required: true } };
const match = (event: string) => ({ json: { path: 'event', equals: event } });
function blueprint(): FlowBlueprint {
  return {
    version: 1, id: 'lifecycle', name: 'Lifecycle', start: 'start', timeout: '10s',
    correlation: { scope: 'device-session', primary: 'id', aliases: ['job'] },
    steps: [
      { id: 'start', name: 'Start', match: match('start'), extract: identity, next: ['middle'] },
      { id: 'middle', name: 'Middle', match: match('middle'), extract: { ...identity, job: { json: 'job' } }, next: ['done'] },
      { id: 'done', name: 'Done', match: match('done'), extract: identity, outcome: 'completed' },
    ],
    errors: [{
      id: 'failure', appliesTo: 'active', match: match('failure'),
      extract: { ...identity, code: { json: 'code' } }, codeField: 'code',
      codes: {}, unknownOutcome: 'failed',
    }],
  };
}
const log = (event: string, id = 'a', values: Record<string, unknown> = {}): LogMessage => ({
  timestamp: 'original', message: JSON.stringify({ event, id, ...values }),
});
function setup(definition = blueprint()) {
  assert.deepEqual(parseFlowBlueprint(JSON.stringify(definition)).diagnostics, []);
  let now = 0;
  const engine = createFlowEngine(() => now);
  engine.setBlueprints([definition], 'v1');
  return { engine, time(value: number) { now = value; } };
}
type Engine = ReturnType<typeof createFlowEngine>;
const captureLosses: [string, (engine: Engine) => void][] = [
  ['explicit gap', engine => engine.gap()],
  ['rejected JSON depth', engine => engine.ingest([{
    timestamp: 'raw', message: '['.repeat(66) + '0' + ']'.repeat(66),
  }])],
  ['pending count overflow', engine => engine.ingest(Array.from({ length: 1001 }, (_, i) => log('done', `other-${i}`)))],
  ['pending byte overflow', engine => engine.ingest(Array.from({ length: 20 }, (_, i) => log('done', `other-${i}`, { padding: 'x'.repeat(60000) })))],
];

for (const [name, loseCapture] of captureLosses) {
  test(`ambiguity remains quarantined after ${name}`, () => {
    const { engine } = setup();
    engine.ingest([log('start'), log('start')]);
    assert.equal(engine.getState().instances[0].completeness, 'ambiguous');
    loseCapture(engine);
    engine.ingest([log('middle'), log('done')]);
    const instance = engine.getState().instances[0];
    assert.equal(instance.outcome, 'running');
    assert.equal(instance.completeness, 'ambiguous');
    assert.deepEqual(instance.observations.map(row => row.stepId), ['start']);
    assert.ok(engine.getState().gaps > 0);
  });

  test(`missing-start provenance survives ${name}`, () => {
    const { engine, time } = setup();
    engine.ingest([log('middle')]);
    time(2001); engine.tick();
    assert.equal(engine.getState().instances[0].completeness, 'missing_start');
    loseCapture(engine);
    engine.ingest([log('done')]);
    const instance = engine.getState().instances[0];
    assert.equal(instance.outcome, 'interrupted');
    assert.equal(instance.completeness, 'missing_start');
    assert.deepEqual(instance.observations.map(row => row.stepId), ['middle', 'done']);
    assert.ok(engine.getState().gaps > 0);
  });
}

test('a truncated terminal does not turn a missing-start flow into success', () => {
  const { engine, time } = setup();
  engine.ingest([log('middle')]);
  time(2001); engine.tick();
  engine.ingest([{ ...log('done'), truncated: true }]);
  assert.equal(engine.getState().instances[0].outcome, 'interrupted');
  assert.equal(engine.getState().instances[0].completeness, 'missing_start');
});

test('capture loss does not prevent a uniquely identified ordinary flow from completing', () => {
  const { engine } = setup();
  engine.ingest([log('start')]); engine.gap();
  engine.ingest([log('middle'), log('done')]);
  assert.equal(engine.getState().instances[0].outcome, 'completed');
  assert.equal(engine.getState().instances[0].completeness, 'capture_gap');
});

for (const terminal of ['completed', 'failed', 'cancelled'] as const) {
  test(`late ${terminal} seals recognition and permits a fresh same-ID operation`, () => {
    const definition = blueprint();
    definition.timeout = '1s'; definition.steps[2].outcome = terminal;
    const { engine, time } = setup(definition);
    engine.ingest([log('start'), log('middle', 'a', { job: 'shared-job' })]);
    time(2000); engine.ingest([log('done')]);
    const closed = engine.getState().instances[0];
    assert.equal(closed.outcome, 'timed_out');
    assert.equal(closed.lateOutcome, terminal);
    assert.equal(closed.endedAt, 1000);
    time(2100); engine.ingest([log('failure', 'a', { code: 'LATE' }), log('middle')]);
    assert.deepEqual(engine.getState().instances[0], closed);
    engine.ingest([log('start'), log('middle', 'a', { job: 'shared-job' })]);
    const rows = engine.getState().instances;
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0], closed);
    assert.equal(rows[1].outcome, 'running');
    assert.equal(rows[1].completeness, 'complete');
    assert.deepEqual(rows[1].observations.map(row => row.stepId), ['start', 'middle']);
    engine.ingest([log('done')]);
    assert.equal(engine.getState().instances[1].outcome, terminal);
  });
}

test('late error-rule terminal closes recognition and keeps pending evidence with its old owner across reload', () => {
  const definition = blueprint(); definition.timeout = '1s';
  const { engine, time } = setup(definition);
  engine.ingest([log('start'), log('done')]);
  time(1100); engine.ingest([log('failure', 'a', { code: 'FAILED' })]);
  const closed = engine.getState().instances[0];
  assert.equal(closed.lateOutcome, 'failed');
  engine.setBlueprints([definition], 'v2');
  engine.ingest([log('done'), log('start'), log('middle')]);
  assert.deepEqual(engine.getState().instances[0], closed);
  const next = engine.getState().instances[1];
  assert.equal(next.outcome, 'running');
  assert.deepEqual(next.observations.map(row => row.stepId), ['start', 'middle']);
  engine.ingest([log('done')]);
  assert.equal(engine.getState().instances[1].outcome, 'completed');
});

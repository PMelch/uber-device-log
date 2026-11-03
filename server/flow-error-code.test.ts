import test from 'node:test';
import assert from 'node:assert/strict';
import { createFlowEngine } from '../shared/flow-engine.js';
import { parseFlowBlueprint } from '../shared/flow-blueprints.js';
import { flowErrorCode, flowPresentation } from '../shared/flow-presentation.js';
import { createFlowAnalysis, type FlowCommand, type FlowWorkerLike } from '../src/flow-analysis.js';
import type { FlowBlueprint, FlowEngineState } from '../shared/flow-types.js';

function blueprint(): FlowBlueprint {
  return {
    version: 1, id: 'codes', name: 'Error codes', start: 'start', timeout: '30s',
    correlation: { scope: 'device-session', primary: 'id' },
    steps: [
      { id: 'start', name: 'Start', match: { json: { path: 'event', equals: 'start' } },
        extract: { id: { json: 'id', required: true } }, next: ['done'] },
      { id: 'done', name: 'Done', match: { json: { path: 'event', equals: 'done' } },
        extract: { id: { json: 'id', required: true } }, outcome: 'completed' },
    ],
    errors: [{
      id: 'failure', appliesTo: 'active', match: { json: { path: 'event', equals: 'failure' } },
      extract: { id: { json: 'id', required: true }, code: { json: 'code', sensitive: true, result: true } },
      codeField: 'code', codes: {
        KNOWN: { description: 'Known failure', outcome: 'cancelled', label: 'Known failure' },
        undefined: { description: 'Literal undefined code', outcome: 'cancelled', label: 'Literal undefined code' },
      },
      unknownOutcome: 'failed', label: 'Unknown failure',
    }],
  };
}

const log = (event: string, id: string, code?: unknown) => ({
  timestamp: 'raw', message: JSON.stringify({ event, id, ...(code === undefined ? {} : { code }) }),
});

function setup() {
  const definition = blueprint();
  assert.deepEqual(parseFlowBlueprint(JSON.stringify(definition)).diagnostics, []);
  const engine = createFlowEngine(() => 0);
  engine.setBlueprints([definition], 'v1');
  return engine;
}

test('non-convertible JSON error codes preserve evidence and do not stop later flows', () => {
  for (const code of [{ toString: null }, { toString: 42, valueOf: null }, [{ toString: false }]]) {
    const engine = setup();
    engine.ingest([log('start', 'bad')]);
    assert.doesNotThrow(() => engine.ingest([
      log('failure', 'bad', code), log('start', 'good'), log('done', 'good'),
    ]));
    const [failed, completed] = engine.getState().instances;
    assert.equal(failed.outcome, 'failed');
    assert.equal(failed.errorCode, undefined);
    assert.equal(failed.errorDescription, undefined);
    assert.deepEqual(failed.expected, []);
    assert.deepEqual(failed.observations.map(item => item.stepId), ['start', 'failure']);
    assert.deepEqual(failed.observations.at(-1)!.payload.code, code);
    assert.equal(completed.outcome, 'completed');
    assert.equal(flowPresentation(failed).label.map(part => part.text).join(''), 'Unknown failure');
    assert.equal(flowPresentation(failed).results[0].sensitive, true);
    assert.equal(flowErrorCode(failed).sensitive, true);
  }
});

test('error code lookup preserves convertible JSON values and distinguishes missing from literal undefined', () => {
  const cases: [unknown, string | undefined][] = [
    ['KNOWN', 'KNOWN'], ['undefined', 'undefined'], [0, '0'], [false, 'false'], [null, 'null'],
    [{ detail: 'value' }, '[object Object]'], [['A', null, 2], 'A,,2'], [undefined, undefined],
  ];
  for (const [value, expected] of cases) {
    const engine = setup();
    engine.ingest([log('start', 'a'), log('failure', 'a', value)]);
    const instance = engine.getState().instances[0];
    const known = expected === 'KNOWN' || expected === 'undefined';
    assert.equal(instance.errorCode, expected);
    assert.equal(instance.outcome, known ? 'cancelled' : 'failed');
    assert.equal(flowPresentation(instance).label.map(part => part.text).join(''),
      expected === 'KNOWN' ? 'Known failure' : expected === 'undefined' ? 'Literal undefined code' : 'Unknown failure');
  }
});

test('presentation safely falls back for retained observations without a normalized error code', () => {
  const engine = setup();
  engine.ingest([log('start', 'a'), log('failure', 'a', 'KNOWN')]);
  const instance = engine.getState().instances[0];
  const error = instance.observations.at(-1)!;
  delete error.errorCode;
  delete instance.errorCode;
  error.payload.code = { toString: null };
  assert.doesNotThrow(() => flowPresentation(instance));
  assert.equal(flowPresentation(instance).label.map(part => part.text).join(''), 'Unknown failure');
  assert.equal(flowPresentation(instance).results[0].sensitive, true);
});

test('analysis worker bridge remains available after a non-convertible error code', async () => {
  const engine = createFlowEngine(() => 0);
  let terminated = false;
  let errors = 0;
  let state: FlowEngineState = { instances: [], gaps: 0 };
  let acknowledged: (() => void) | undefined;
  const worker: FlowWorkerLike = {
    onmessage: null, onerror: null,
    terminate() { terminated = true; },
    postMessage(command: FlowCommand & { id: number }) {
      try {
        if (command.type === 'snapshot') engine.setBlueprints(command.blueprints, command.revision);
        else if (command.type === 'ingest') engine.ingest(command.messages);
        worker.onmessage?.({ data: { id: command.id, state: engine.getState() } });
      } catch (error) {
        worker.onmessage?.({ data: { id: command.id, error: String(error) } });
      } finally { acknowledged?.(); }
    },
  };
  const analysis = createFlowAnalysis(() => worker, { state(value) { state = value; }, error() { errors++; } });
  async function send(action: () => void) {
    const done = new Promise<void>(resolve => { acknowledged = resolve; });
    action();
    await done;
    acknowledged = undefined;
  }
  try {
    await send(() => analysis.snapshot([blueprint()], 'v1'));
    await send(() => analysis.ingest([log('start', 'a'), log('failure', 'a', { toString: null })]));
    assert.equal(errors, 0, 'a malformed code must not fail the analysis controller');
    assert.equal(terminated, false);
    await send(() => analysis.ingest([log('start', 'b'), log('done', 'b')]));
    assert.deepEqual(state.instances.map(instance => instance.outcome), ['failed', 'completed']);
  } finally { analysis.dispose(); }
});

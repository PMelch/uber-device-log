import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFlowBlueprint } from '../shared/flow-blueprints.js';
import { createFlowEngine } from '../shared/flow-engine.js';
import { flowPresentation } from '../shared/flow-presentation.js';
import { flowRouteStates, flowRouteTopology } from '../src/flow-path.js';

// Deliberately use inferred drafts: validation is the boundary for author input.
const draft = (): any => ({ version: 1, id: 'multi', name: 'Multi', starts: ['ios', 'android'], timeout: '5s', correlation: { scope: 'device-session', primary: 'id' }, label: 'Operation {vars.token}', steps: [
  { id: 'ios', name: 'iOS', match: { json: { path: 'event', equals: 'ios' } }, extract: { id: { json: 'id', required: true }, token: { json: 'iosToken', required: true, variable: 'token', sensitive: true } }, next: ['shared'] },
  { id: 'android', name: 'Android', match: { json: { path: 'event', equals: 'android' } }, extract: { id: { json: 'id', required: true }, token: { json: 'androidToken', required: true, variable: 'token' } }, next: ['shared'] },
  { id: 'shared', name: 'Shared', extract: { id: { json: 'id' } }, match: { all: [{ json: { path: 'event', equals: 'shared' } }, { json: { path: 'token', equalsFrom: { variable: 'token' } } }] }, label: 'Shared {vars.token}', next: ['done'] },
  { id: 'done', name: 'Done', match: { json: { path: 'event', equals: 'done' } }, extract: { id: { json: 'id', required: true } }, outcome: 'completed' },
] });
const log = (event: string, fields: object = {}) => ({ timestamp: 'now', message: JSON.stringify({ event, ...fields }), source: { key: 'phone', name: 'Phone', deviceId: 'phone', platform: 'android' as const } });
function setup(b = draft()) {
  const parsed = parseFlowBlueprint(JSON.stringify(b));
  assert.deepEqual(parsed.diagnostics, []);
  let now = 0;
  const engine = createFlowEngine(() => now);
  engine.setBlueprints([parsed.blueprint!], 'revision');
  return { engine, advance() { now += 2001; engine.tick(); } };
}
const text = (instance: Parameters<typeof flowPresentation>[0]) => flowPresentation(instance).label.map(part => part.text).join('');

test('different starts continue through one shared stream with isolated variables', () => {
  const { engine } = setup();
  engine.ingest([log('ios', { id: 'a', iosToken: 'secret' }), log('android', { id: 'b', androidToken: 'public' }), log('shared', { token: 'public' }), log('shared', { token: 'secret' }), log('done', { id: 'a' }), log('done', { id: 'b' })]);
  const rows = engine.getState().instances;
  assert.deepEqual(rows.map(row => row.observations.map(o => o.stepId)), [['ios', 'shared', 'done'], ['android', 'shared', 'done']]);
  assert.ok(rows.every(row => row.outcome === 'completed' && row.completeness === 'complete'));
  assert.equal(text(rows[0]!), 'Shared secret');
  assert.ok(flowPresentation(rows[0]!).label.some(part => part.sensitive));
  assert.ok(flowPresentation(rows[1]!).label.every(part => !part.sensitive));
});

test('a shared variable must be required on every incoming path, including single-start forks', () => {
  for (const multi of [true, false]) for (const change of ['optional', 'absent', 'bypass']) {
    const b = draft(); delete b.label;
    if (!multi) { delete b.starts; b.start = 'start'; b.steps.unshift({ id: 'start', name: 'Start', match: { contains: 'start' }, extract: { id: { json: 'id', required: true } }, next: ['ios', 'android'] }); }
    if (change === 'optional') b.steps.find((s: any) => s.id === 'android').extract.token.required = false;
    if (change === 'absent') delete b.steps.find((s: any) => s.id === 'android').extract.token;
    if (change === 'bypass') {
      if (multi) b.starts.push('shared'); else b.steps[0].next.push('shared');
      b.steps.find((s: any) => s.id === 'shared').extract = { id: { json: 'id', required: true } };
    }
    assert.ok(parseFlowBlueprint(JSON.stringify(b)).diagnostics.some(d => /every incoming route|start.*reference|Start steps/i.test(d.message)), `${multi}: ${change}`);
  }
});

test('optional branch references are explicit and missing comparisons never become matches', () => {
  const b = draft(); delete b.steps[1].extract.token;
  b.label = 'Operation {vars.token?}'; b.steps[2].label = 'Shared {ios.token?}';
  b.steps[2].match.all[1].json.equalsFrom.optional = true;
  const { engine } = setup(b);
  engine.ingest([log('android', { id: 'a' }), log('shared', { token: 'anything' })]);
  assert.equal(engine.getState().instances[0]!.observations.length, 1);
  assert.equal(text(engine.getState().instances[0]!), 'Operation ');
  engine.ingest([log('ios', { id: 'b', iosToken: 'yes' }), log('shared', { token: 'yes' })]);
  assert.equal(text(engine.getState().instances[1]!), 'Shared yes');
});

test('malformed start sets and variable declarations are rejected', () => {
  for (const starts of [[], ['ios', 'ios'], ['unknown'], true, 'ios', [null]]) {
    const b = draft(); b.starts = starts; assert.ok(parseFlowBlueprint(JSON.stringify(b)).diagnostics.length);
  }
  const changes = [
    (b: any) => b.start = 'ios', (b: any) => delete b.starts,
    (b: any) => b.steps[0].repeatable = true,
    (b: any) => delete b.steps[0].extract.id,
    (b: any) => b.steps[0].next = ['android'],
    (b: any) => b.steps[0].extract.token.variable = '__proto__.x',
    (b: any) => b.steps[0].extract.other = { json: 'other', variable: 'token' },
  ];
  for (const change of changes) { const b = draft(); change(b); assert.ok(parseFlowBlueprint(JSON.stringify(b)).diagnostics.length); }
});

test('required step references also require a required extractor; optional future references remain invalid', () => {
  const b = draft(); delete b.label;
  b.steps[2].label = '{ios.token}'; assert.ok(parseFlowBlueprint(JSON.stringify(b)).diagnostics.length);
  b.steps[2].label = '{ios.token?}'; assert.deepEqual(parseFlowBlueprint(JSON.stringify(b)).diagnostics, []);
  b.steps[0].label = '{shared.token?}'; assert.ok(parseFlowBlueprint(JSON.stringify(b)).diagnostics.length);
  delete b.steps[0].label; delete b.starts; b.start = 'ios'; b.steps.splice(1, 1); b.steps[0].extract.token.required = false;
  b.steps[2].label = '{ios.token}'; assert.ok(parseFlowBlueprint(JSON.stringify(b)).diagnostics.length);
});

test('ambiguous starts retain one ambiguous instance without selecting a route', () => {
  const b = draft(); b.steps[1].match = b.steps[0].match; b.steps[1].extract = b.steps[0].extract;
  const { engine, advance } = setup(b);
  engine.ingest([log('ios', { id: 'a', iosToken: 't' })]); advance();
  const rows = engine.getState().instances;
  assert.equal(rows.length, 1); assert.equal(rows[0]!.completeness, 'ambiguous');
  assert.deepEqual(rows[0]!.observations, []); assert.deepEqual(rows[0]!.expected, ['ios', 'android']);
});

test('required variables reject missing or non-scalar start values and preserve false and zero', () => {
  for (const value of [undefined, null, {}, [], Infinity]) {
    const { engine, advance } = setup(); engine.ingest([log('ios', { id: 'a', iosToken: value })]); advance(); assert.equal(engine.getState().instances.length, 0);
  }
  for (const value of [false, 0]) {
    const { engine } = setup(); engine.ingest([log('android', { id: 'a', androidToken: value }), log('shared', { token: value }), log('done', { id: 'a' })]); assert.equal(engine.getState().instances[0]!.outcome, 'completed');
  }
});

test('reordered evidence can join either start and never transfers between incarnations', () => {
  const { engine } = setup();
  engine.ingest([log('shared', { id: 'a', token: 't' }), log('android', { id: 'a', androidToken: 't' }), log('done', { id: 'a' })]);
  assert.deepEqual(engine.getState().instances[0]!.observations.map(o => o.stepId), ['android', 'shared', 'done']);
});

test('unselected starts and their exclusive paths are alternatives in the route overview', () => {
  const b = draft(); const topology = flowRouteTopology(b.steps, b.starts);
  const states = flowRouteStates(topology, new Set(['android']), ['shared']);
  assert.equal(states.get('ios'), 'other'); assert.equal(states.get('android'), 'observed'); assert.equal(states.get('shared'), 'expected'); assert.equal(states.get('done'), 'missing');
});

test('shared variables also converge after ordinary alternative branches', () => {
  const b = draft(); delete b.starts; b.start = 'start'; b.label = 'Operation';
  b.steps.unshift({ id: 'start', name: 'Start', match: { json: { path: 'event', equals: 'start' } }, extract: { id: { json: 'id', required: true } }, next: ['ios', 'android'] });
  const { engine } = setup(b);
  engine.ingest([log('start', { id: 'a' }), log('start', { id: 'b' }), log('ios', { id: 'a', iosToken: 'ta' }), log('android', { id: 'b', androidToken: 'tb' }), log('shared', { token: 'ta' }), log('shared', { token: 'tb' }), log('done', { id: 'a' }), log('done', { id: 'b' })]);
  assert.ok(engine.getState().instances.every(row => row.outcome === 'completed'));
});

test('optional variable reassignment clears old values and cannot publish rejected evidence', () => {
  const b = draft();
  b.steps[2].match = { json: { path: 'event', equals: 'shared' } };
  b.steps[2].repeatable = true;
  b.steps[2].extract.token = { json: 'token', variable: 'token' };
  b.steps[2].label = 'Shared {vars.token?}';
  b.steps[3].match = { all: [{ json: { path: 'event', equals: 'done' } }, { json: { path: 'token', equalsFrom: { variable: 'token', optional: true } } }] };
  const mandatory = structuredClone(b); mandatory.steps[3].match.all[1].json.equalsFrom.optional = false;
  assert.ok(parseFlowBlueprint(JSON.stringify(mandatory)).diagnostics.some(d => /every incoming route/.test(d.message)));
  const { engine } = setup(b);
  engine.ingest([log('ios', { id: 'a', iosToken: 'old' }), log('shared', { id: 'a', token: 'new' }), log('shared', { id: 'a' }), log('done', { id: 'a', token: 'new' })]);
  assert.equal(engine.getState().instances[0]!.outcome, 'running');
  assert.equal(text(engine.getState().instances[0]!), 'Shared ');
  engine.ingest([log('shared', { id: 'a', token: 'current' }), log('done', { id: 'a', token: 'current' })]);
  assert.equal(engine.getState().instances[0]!.outcome, 'completed');
  const b2 = draft(); b2.steps[0].next = ['bridge'];
  b2.steps.push({ id: 'bridge', name: 'Bridge', match: { json: { path: 'event', equals: 'bridge' } }, extract: { id: { json: 'id', required: true } }, next: ['shared'] });
  b2.steps[2].extract.token = { json: 'token', variable: 'token', required: true }; b2.steps[2].match = { json: { path: 'event', equals: 'shared' } };
  const run = setup(b2); run.engine.ingest([log('ios', { id: 'a', iosToken: 'safe' }), log('shared', { id: 'a', token: 'rejected' })]); run.advance();
  const row = run.engine.getState().instances[0]!;
  assert.equal(row.observations.at(-1)!.accepted, false);
  assert.equal(text(row), 'Operation safe');
});

test('error labels require variables on every eligible failure route', () => {
  const b = draft(); b.errors = [{ id: 'error', appliesTo: 'active', match: { contains: 'failure' }, extract: { id: { json: 'id' }, code: { json: 'code' } }, codeField: 'code', codes: {}, unknownOutcome: 'failed', label: 'Failed {vars.token}' }];
  assert.deepEqual(parseFlowBlueprint(JSON.stringify(b)).diagnostics, []);
  b.steps[0].extract.extra = { json: 'extra', variable: 'extra', required: true };
  b.errors[0].label = 'Failed {vars.extra}';
  assert.ok(parseFlowBlueprint(JSON.stringify(b)).diagnostics.length);
  b.errors[0].label = 'Failed {vars.extra?}';
  const { engine } = setup(b);
  engine.ingest([log('android', { id: 'a', androidToken: 't' }), log('failure', { id: 'a', code: 'NO' })]);
  assert.equal(text(engine.getState().instances[0]!), 'Failed ');
});

test('optional labels cannot reference undeclared or future values and cannot blank the summary', () => {
  const b = draft(); b.steps[2].label = '{vars.unknown?}';
  assert.ok(parseFlowBlueprint(JSON.stringify(b)).diagnostics.length);
  b.steps[2].label = '{android.only?}'; b.steps[1].extract.only = { json: 'only' };
  const { engine } = setup(b);
  engine.ingest([log('ios', { id: 'a', iosToken: 't' }), log('shared', { token: 't' })]);
  assert.equal(text(engine.getState().instances[0]!), 'Operation t');
});

test('malformed new reference shapes and reserved namespaces return diagnostics without throwing', () => {
  for (const change of [
    (b: any) => b.errors = [null],
    (b: any) => b.steps[2].match.all[1].json.equalsFrom = { variable: 'token', step: 'ios', field: 'token' },
    (b: any) => b.steps[2].match.all[1].json.equalsFrom.optional = 'true',
    (b: any) => { b.steps[2].id = 'vars'; b.steps[0].next = b.steps[1].next = ['vars']; },
    (b: any) => b.steps[2].extract = { value: { json: 'v', variable: 'constructor' } },
  ]) {
    const b = draft(); change(b); assert.ok(parseFlowBlueprint(JSON.stringify(b)).diagnostics.length);
  }
});

test('shared progress variables and root labels keep their pinned definition', () => {
  const { engine } = setup(); engine.ingest([log('ios', { id: 'a', iosToken: 'one' })]);
  const b = draft(); b.steps[2].label = 'Changed';
  engine.setBlueprints([parseFlowBlueprint(JSON.stringify(b)).blueprint!], 'new');
  engine.ingest([log('shared', { token: 'one' }), log('done', { id: 'a' })]);
  assert.equal(text(engine.getState().instances[0]!), 'Shared one');
  assert.equal(engine.getState().instances[0]!.revision, 'revision');
});

test('required repeat matchers retain their variable guarantee after every accepted update', () => {
  const b = draft(); b.steps[2].repeatable = true;
  b.steps[2].extract.token = { json: 'nextToken', variable: 'token' };
  b.steps[2].label = 'Shared {vars.token?}';
  assert.ok(parseFlowBlueprint(JSON.stringify(b)).diagnostics.some(d => /every incoming route/.test(d.message)));
  b.steps[2].extract.token.required = true;
  assert.deepEqual(parseFlowBlueprint(JSON.stringify(b)).diagnostics, []);
  const { engine } = setup(b);
  engine.ingest([log('ios', { id: 'a', iosToken: 't1' }), log('shared', { id: 'a', token: 't1', nextToken: 't2' }), log('shared', { id: 'a', token: 't2', nextToken: 't3' })]);
  assert.equal(text(engine.getState().instances[0]!), 'Shared t3');
  assert.equal(engine.getState().instances[0]!.observations.length, 3);
  const optional = draft(); optional.steps[2].repeatable = true; optional.steps[2].extract.token = { json: 'nextToken', variable: 'token' }; optional.steps[2].label = 'Shared {vars.token?}'; optional.steps[2].match.all[1].json.equalsFrom.optional = true;
  assert.deepEqual(parseFlowBlueprint(JSON.stringify(optional)).diagnostics, []);
});

test('dotted node IDs cannot shadow the shared variable namespace', () => {
  const b = draft(); delete b.label;
  b.steps[0].id = b.starts[0] = 'vars.ios';
  b.steps[0].extract.token.variable = b.steps[1].extract.token.variable = 'ios.token';
  b.steps[2].match.all[1].json.equalsFrom.variable = 'ios.token'; b.steps[2].label = '{vars.ios.token}';
  assert.ok(parseFlowBlueprint(JSON.stringify(b)).diagnostics.some(d => /reserved/.test(d.message)));
});

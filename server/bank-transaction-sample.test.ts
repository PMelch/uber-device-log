import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import { parseFlowBlueprint } from '../shared/flow-blueprints.js';
import { createFlowEngine } from '../shared/flow-engine.js';
import { flowPresentation } from '../shared/flow-presentation.js';
import type { LogMessage } from '../shared/types.js';

async function replayBankSample() {
  const parsed = parseFlowBlueprint(await readFile(new URL('../test_flow_project/.udl/flows/bank-transaction.yaml', import.meta.url), 'utf8'), 'bank-transaction.yaml');
  assert.deepEqual(parsed.diagnostics, []);
  assert.ok(parsed.blueprint);
  let clock = 1000;
  const engine = createFlowEngine(() => clock);
  engine.setBlueprints([parsed.blueprint], 'bank-fixture');
  const events = (await readFile(new URL('../test_flow_project/bank-transaction-events.jsonl', import.meta.url), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  for (const event of events) {
    const message: LogMessage = { timestamp: new Date(clock).toISOString(), message: JSON.stringify(event), source: { key: 'bank-fixture', name: 'Fictional bank logs', deviceId: 'fixture-phone', platform: 'android' } };
    engine.ingest([message]);
    clock += 100;
    engine.tick();
  }
  return { engine, advance() { clock += 61000; engine.tick(); }, instances: () => engine.getState().instances };
}

test('fictional bank sample recognizes concurrent success, declines, cancellation and manual decisions without treating review as failure', async () => {
  const sample = await replayBankSample();
  const find = (id: string) => sample.instances().find(instance => instance.bindings.transactionId === id)!;
  assert.equal(sample.instances().length, 7);
  assert.equal(find('bank-success').outcome, 'completed');
  assert.equal(find('bank-insufficient').outcome, 'failed');
  assert.equal(find('bank-insufficient').errorCode, 'INSUFFICIENT_FUNDS');
  assert.equal(find('bank-fraud').errorCode, 'FRAUD_SUSPECTED');
  assert.equal(find('bank-cancelled').outcome, 'cancelled');
  assert.equal(find('bank-review-approved').outcome, 'completed');
  assert.equal(find('bank-review-rejected').errorCode, 'REVIEW_REJECTED');
  assert.ok(find('bank-review-approved').observations.some(value => value.stepId === 'review'));
  assert.equal(find('bank-timeout').outcome, 'running');
  sample.advance();
  assert.equal(find('bank-timeout').outcome, 'timed_out');
  assert.equal(find('bank-timeout').errorCode, undefined, 'a capture deadline does not invent a bank rejection');
  assert.equal(find('bank-success').observations.at(-1)?.payload.reference, 'REF-FICTIONAL-001');
});

test('bank summaries present accepted values, result fields, known-code tones and sensitive account metadata', async () => {
  const sample = await replayBankSample();
  const find = (id: string) => sample.instances().find(instance => instance.bindings.transactionId === id)!;
  const success = flowPresentation(find('bank-success'));
  assert.match(success.label.map(part => part.text).join(''), /Transfer completed: 125 EUR → Demo Recipient 1 · Reference REF-FICTIONAL-001/);
  assert.ok(success.label.some(part => part.tone === 'success'));
  assert.ok(success.label.some(part => part.sensitive && part.text === 'DE00-FICTIONAL-ACCOUNT-1'));
  assert.deepEqual(Object.fromEntries(success.results.filter(result => !result.sensitive).map(result => [result.field, result.value])), { amount: 125, currency: 'EUR', recipient: 'Demo Recipient 1', reference: 'REF-FICTIONAL-001' });
  assert.equal(success.results.find(result => result.field === 'account')?.sensitive, true);
  const declined = flowPresentation(find('bank-insufficient'));
  assert.match(declined.label.map(part => part.text).join(''), /Insufficient funds/);
  assert.ok(declined.label.some(part => part.tone === 'error'));
  assert.equal(declined.results.find(result => result.field === 'errorCode')?.value, 'INSUFFICIENT_FUNDS');
  assert.match(flowPresentation(find('bank-review-rejected')).label.map(part => part.text).join(''), /Manual review rejected/);
  const approved = find('bank-review-approved');
  const waiting = { ...approved, observations: approved.observations.slice(0, approved.observations.findIndex(value => value.stepId === 'review') + 1) };
  const pending = flowPresentation(waiting);
  assert.match(pending.label.map(part => part.text).join(''), /Manual review pending/);
  assert.ok(pending.label.some(part => part.tone === 'warning'));
  assert.equal(pending.results.some(result => result.field === 'reference'), false);
  const unaccepted = { ...waiting, observations: [...waiting.observations, { ...approved.observations.at(-1)!, accepted: false }] };
  assert.deepEqual(flowPresentation(unaccepted), pending, 'retained but unaccepted evidence does not promote labels or results');
});

test('bank demo emitter uses fresh IDs and emits only supported fictional routes without network APIs', async () => {
  const html = await readFile(new URL('../test_flow_project/bank-transaction-demo.html', import.meta.url), 'utf8');
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1]!;
  const events: Record<string, unknown>[] = [];
  const output = { textContent: '', scrollTop: 0, scrollHeight: 100 };
  let serial = 0;
  const context = createContext({
    document: { querySelector: (selector: string) => selector === '#amount' ? { value: '125' } : output, querySelectorAll: () => [] },
    console: { log: (message: string) => events.push(JSON.parse(message)) },
    crypto: { randomUUID: () => `fictional-${++serial}` },
    setTimeout: (callback: () => void) => { callback(); return 0; },
  });
  runInContext(script, context);
  for (const route of ['success', 'insufficient', 'fraud', 'cancelled', 'review-approved', 'review-rejected', 'review-pending', 'timeout']) await runInContext(`run(${JSON.stringify(route)})`, context);
  assert.equal(new Set(events.filter(event => event.event === 'bank.transfer.requested').map(event => event.transactionId)).size, 8);
  assert.ok(events.every(event => typeof event.transactionId === 'string'));
  assert.ok(events.some(event => event.code === 'REVIEW_REJECTED'));
  const blueprint = parseFlowBlueprint(await readFile(new URL('../test_flow_project/.udl/flows/bank-transaction.yaml', import.meta.url), 'utf8')).blueprint!;
  let clock = 0;
  const engine = createFlowEngine(() => clock);
  engine.setBlueprints([blueprint], 'emitter');
  for (const event of events) { engine.ingest([{ timestamp: new Date(clock).toISOString(), message: JSON.stringify(event) }]); clock += 100; }
  const instances = engine.getState().instances;
  assert.equal(instances.filter(instance => instance.outcome === 'completed').length, 2);
  assert.equal(instances.filter(instance => instance.outcome === 'failed').length, 3);
  assert.equal(instances.filter(instance => instance.outcome === 'cancelled').length, 1);
  assert.equal(instances.filter(instance => instance.outcome === 'running').length, 2);
});

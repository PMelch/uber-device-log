import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { FlowProject } from './flow-project.js';
import { createFlowEngine } from '../shared/flow-engine.js';
import type { LogMessage } from '../shared/types.js';

test('actual test project sample completes purchase and login and presents asset error', async () => {
  const project = await FlowProject.create(fileURLToPath(new URL('../test_flow_project', import.meta.url)));
  const snapshot = await project.reload();
  assert.deepEqual(snapshot.diagnostics, []);
  const events = (await readFile(new URL('../test_flow_project/sample-events.jsonl', import.meta.url), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  let clock = 1_000;
  const engine = createFlowEngine(() => clock);
  engine.setBlueprints(snapshot.blueprints, snapshot.revision);
  for (const event of events) {
    const message: LogMessage = { timestamp: new Date(clock).toISOString(), message: JSON.stringify(event), source: { key: 'demo-webview', name: 'Demo WebView', platform: 'android', deviceId: 'demo-device', webview: {id:'demo',socket:'demo',title:'Demo',url:'https://example.invalid'} } };
    engine.ingest([message]);
    clock += 700;
    engine.tick();
  }
  const state = engine.getState();
  const purchase = state.instances.find(i => i.bindings.attemptId === 'attempt-demo-1');
  assert.equal(purchase?.outcome, 'completed');
  assert.equal(purchase?.completeness, 'complete');
  assert.ok(purchase?.observations.some(o => o.stepId === 'submit' && o.accepted !== false));
  const submission = purchase!.observations.find(o => o.stepId === 'submit')!;
  assert.equal(JSON.parse(submission.message.message).uid, undefined, 'submission is identified solely by receipt transaction ID');
  assert.equal(state.instances.find(i => i.bindings.requestId === 'login-demo-1')?.outcome, 'completed');
  const asset = state.instances.find(i => i.bindings.downloadId === 'asset-demo-1');
  assert.equal(asset?.outcome, 'failed');
  assert.equal(asset?.errorCode, 'CHECKSUM_MISMATCH');
  assert.match(String(asset?.observations.at(-1)?.payload.stack), /verifyAsset/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { flowSummary } from '../src/flow-path.ts';

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

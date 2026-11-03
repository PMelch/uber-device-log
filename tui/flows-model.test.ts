import { test, expect } from 'bun:test';
import type { FlowBlueprint, FlowSnapshot } from '../shared/flow-types';
export const blueprint: FlowBlueprint = { version: 1, id: 'checkout', name: 'Checkout', start: 'start', timeout: '10s', correlation: { scope: 'device-session', primary: 'id' }, steps: [
  { id: 'start', name: 'Request', match: { json: { path: 'event', equals: 'start' } }, extract: { id: { json: 'id', required: true }, secret: { json: 'secret', sensitive: true, result: true } }, next: ['done'] },
  { id: 'done', name: 'Confirmed', match: { json: { path: 'event', equals: 'done' } }, extract: { id: { json: 'id', required: true } }, outcome: 'completed' },
] };
export const snapshot = (): FlowSnapshot => ({ enabled: true, projectName: 'Fixture', directory: '.udl/flows', revision: 'v1', blueprints: [blueprint], files: [], diagnostics: [] });
export const log = (event: string, id = 'a') => ({ timestamp: '2026-11-03T12:00:00Z', message: JSON.stringify({ event, id, secret: 'hidden-token' }), source: { key: 'phone', deviceId: 'phone', name: 'Phone', platform: 'android' as const } });
async function until(check: () => boolean) { for (let i = 0; i < 100 && !check(); i++) await Bun.sleep(10); expect(check()).toBe(true); }

test('terminal flow analysis uses the shared worker and interrupts capture boundaries', async () => {
  const { createTuiFlows } = await import('./flows-model').catch(() => ({})) as any;
  expect(typeof createTuiFlows).toBe('function');
  const flows = createTuiFlows({ load: async () => snapshot(), pollMs: 0 });
  try {
    await flows.reload(); flows.ingest([log('start'), log('done')]);
    await until(() => flows.state.instances[0]?.outcome === 'completed');
    flows.ingest([log('start', 'b')]); flows.interrupt();
    await until(() => flows.state.instances.some((i: any) => i.outcome === 'interrupted'));
    flows.clear(); expect(flows.state.instances.length).toBe(0);
    flows.ingest([log('start', 'c')]); flows.gap();
    await until(() => flows.state.instances[0]?.completeness === 'capture_gap');
  } finally { flows.dispose(); }
});

test('terminal flow reload coalesces and ignores late results after disposal', async () => {
  const { createTuiFlows } = await import('./flows-model').catch(() => ({})) as any;
  expect(typeof createTuiFlows).toBe('function');
  let finish!: (s: FlowSnapshot) => void; let calls = 0;
  const flows = createTuiFlows({ load: () => { calls++; return new Promise(resolve => { finish = resolve; }); }, pollMs: 0 });
  const first = flows.reload(); const second = flows.reload();
  await Promise.resolve(); expect(calls).toBe(1);
  flows.dispose(); finish(snapshot()); await Promise.all([first, second]);
  expect(flows.snapshot).toBeUndefined();
});

test('flow deadlines advance without incoming logs and a failed load can be retried', async () => {
  const { createTuiFlows } = await import('./flows-model');
  let fail = true;
  const flows = createTuiFlows({ load: async () => { if (fail) throw new Error('offline'); return { ...snapshot(), blueprints: [{ ...blueprint, timeout: '50ms' }] }; }, pollMs: 0 });
  try {
    await flows.reload(); expect(flows.error?.code).toBe('flowsNetworkError');
    flows.ingest([log('start')]); fail = false; await flows.reload();
    await until(() => flows.state.instances[0]?.outcome === 'timed_out');
    expect(flows.error).toBeUndefined();
  } finally { flows.dispose(); }
});

test('truncated events buffered before blueprint loading retain the capture-gap signal', async () => {
  const { createTuiFlows } = await import('./flows-model');
  const flows = createTuiFlows({ load: async () => snapshot(), pollMs: 0 });
  try {
    flows.ingest([{ ...log('start'), truncated: true }]); await flows.reload();
    await until(() => flows.state.instances.length > 0);
    expect(flows.state.gaps).toBeGreaterThan(0);
  } finally { flows.dispose(); }
});

test('worker failure remains actionable across registry failures and recovery until restart', async () => {
  const { createTuiFlows } = await import('./flows-model');
  let unavailable = false, workerCount = 0;
  const flows = createTuiFlows({ load: async () => { if (unavailable) throw new Error('offline'); return snapshot(); }, pollMs: 0,
    worker() {
      const fail = ++workerCount === 1;
      const worker: import('../src/flow-analysis').FlowWorkerLike = { onmessage: null, onerror: null, terminate() {}, postMessage(command) { queueMicrotask(() => worker.onmessage?.({ data: fail ? { id: command.id, error: 'failed worker' } : { id: command.id, activatedRevision: 'v1' } })); } };
      return worker;
    },
  });
  try {
    await flows.reload(); await until(() => flows.error?.code === 'flowsWorkerError');
    unavailable = true; await flows.reload();
    expect(flows.error?.code).toBe('flowsWorkerError');
    unavailable = false; await flows.reload();
    expect(flows.error?.code).toBe('flowsWorkerError');
    flows.restart(); expect(workerCount).toBe(2);
    await until(() => !flows.error);
  } finally { flows.dispose(); }
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBuiltinProviders, providerTarget, openProviderLogs } from './providers';
import type { Device, LogMessage } from '../shared/types';
import type { OpenLogs, Stop } from './devices';
import type { CaptureRecord, CaptureEnd } from '../shared/providers';
const device: Device = { id: 'a:/b', name: 'Phone', platform: 'android', state: 'connected' };
const page = { id: 'p', socket: 's', title: 'Title', url: 'https://example.test' };

test('four versioned built-ins expose stable identities, parents and explicit capabilities', () => {
  const providers = createBuiltinProviders(async () => () => {});
  assert.equal(providers.length, 4);
  for (const platform of ['android', 'ios'] as const) for (const webview of [undefined, page]) {
    const target = providerTarget({ ...device, platform, webview });
    const provider = providers.find(p => p.id === target.providerId)!;
    assert.equal(provider.apiVersion, 1);
    assert.equal(target.id, providerTarget({ ...device, platform, name: 'Renamed', webview: webview && { ...page, title: 'Changed', url: 'new' } }).id);
    assert.equal(target.parentId, webview ? providerTarget({ ...device, platform }).id : undefined);
    assert.equal(target.capabilities.logs, true);
    assert.equal(target.capabilities.javascript?.sideEffects, webview ? true : undefined);
  }
  assert.notEqual(providerTarget(device).id, providerTarget({ ...device, platform: 'ios' }).id);
});

test('every built-in uses the transport and emits unified records preserving input', async () => {
  for (const platform of ['android', 'ios'] as const) for (const webview of [undefined, page]) {
    const selected = { ...device, platform, webview };
    const raw: LogMessage = { timestamp: 'now', message: 'original', level: 'W', pid: 4, tag: 'tag' };
    let stops = 0;
    const providers = createBuiltinProviders(async (actual, message) => {
      assert.deepEqual(actual, selected); message(raw); return () => { stops++; };
    });
    const target = providerTarget(selected);
    const records: CaptureRecord[] = [];
    const session = providers.find(p => p.id === target.providerId)!.open(target, { record: r => records.push(r), end: () => {} });
    await session.ready;
    assert.equal(records[0].targetId, target.id);
    assert.equal(records[0].raw, raw);
    assert.equal(records[0].message, raw.message);
    session.dispose(); session.dispose(); assert.equal(stops, 1);
  }
});

test('abort during startup suppresses callbacks and releases late resources once', async () => {
  let resolve!: (stop: Stop) => void;
  let emit!: Parameters<OpenLogs>[1];
  let stops = 0, records = 0, ends = 0;
  const providers = createBuiltinProviders((_d, message) => { emit = message; return new Promise(r => { resolve = r; }); });
  const abort = new AbortController();
  const session = providers[0]!.open(providerTarget(device), { record: () => { records++; }, end: () => { ends++; } }, abort.signal);
  abort.abort(); emit({ timestamp: '', message: '' }); resolve(() => { stops++; });
  await session.ready; session.dispose();
  assert.equal(stops, 1); assert.equal(records, 0); assert.equal(ends, 0);
});

test('pre-abort never opens transport; startup failures and terminal events settle once', async () => {
  let opens = 0;
  const providers = createBuiltinProviders(async () => { opens++; throw new Error('failed'); });
  const abort = new AbortController(); abort.abort();
  await providers[0]!.open(providerTarget(device), { record() {}, end() {} }, abort.signal).ready;
  assert.equal(opens, 0);
  const ends: CaptureEnd[] = [];
  const session = providers[0]!.open(providerTarget(device), { record() {}, end: e => ends.push(e) });
  await assert.rejects(session.ready, /failed/);
  assert.equal(ends.length, 0); // startup errors reject ready, never double-report
  let stops = 0;
  const terminal = createBuiltinProviders(async (_d, message, end) => {
    end('gone'); end('again'); message({ timestamp: '', message: 'late' }); return () => { stops++; };
  })[0]!.open(providerTarget(device), { record() { assert.fail('late delivery'); }, end: e => ends.push(e) });
  await terminal.ready;
  assert.equal(ends.length, 1); assert.equal(ends[0].reason, 'gone'); assert.equal(stops, 1);
});

test('discovery partitions targets and rejects cancellation and foreign identities', async () => {
  let calls = 0;
  const providers = createBuiltinProviders(async () => () => {}, async () => {
    calls++; return { devices: [device, { ...device, platform: 'ios', webviews: [page] }], warnings: [] };
  });
  const targets = await Promise.all(providers.map(p => p.discover()));
  assert.deepEqual(targets.map(t => t.length), [1, 1, 0, 1]);
  assert.equal(targets[3]![0]!.parentId, targets[1]![0]!.id);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(providers[0]!.discover(abort.signal), { name: 'AbortError' });
  assert.equal(calls, 4);
  assert.throws(() => providers[0]!.open(targets[1]![0]!, { record() {}, end() {} }), /belong/);
  assert.throws(() => providers[0]!.open({ ...targets[0]![0]!, id: 'forged' }, { record() {}, end() {} }), /belong/);
});

test('compatibility bridge dispatches all sources without changing legacy records', async () => {
  const raw = { timestamp: 'now', message: 'text' };
  const open = openProviderLogs(createBuiltinProviders(async (_d, message) => { message(raw); return () => {}; }));
  for (const platform of ['android', 'ios'] as const) for (const webview of [undefined, page]) {
    const messages: LogMessage[] = [];
    const stop = await open({ ...device, platform, webview }, m => messages.push(m), () => {});
    assert.equal(messages[0], raw); stop();
  }
});

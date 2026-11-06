import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { RuntimeConsole } from './runtime-console.js';

function fixture(platform: 'android' | 'ios' = 'android') {
  const runtime = new RuntimeConsole(platform);
  const handlers = new Map<number, Set<(event: any) => void>>();
  const timers = new Map<number, () => void>();
  let now = 1000;
  const windows: any[] = [{}, {}];
  windows[0].top = windows[0]; windows[0].frames = [windows[1]];
  windows[1].top = windows[0]; windows[1].frames = [];
  const realms = windows.map((window, index) => vm.createContext({ window, Date: { now: () => now },
    setInterval: (fn: () => void) => { timers.set(index + 1, fn); return index + 1; }, clearInterval: (id: number) => timers.delete(id),
    addEventListener: (_: string, fn: (event: any) => void) => { const list = handlers.get(index + 1) ?? new Set(); list.add(fn); handlers.set(index + 1, list); },
    removeEventListener: (_: string, fn: (event: any) => void) => { const list = handlers.get(index + 1); list?.delete(fn); if (!list?.size) handlers.delete(index + 1); } }));
  runtime.attach('page', packet => {
    let result: any = {};
    if (packet.method === 'Runtime.evaluate') {
      try { result = { result: { value: vm.runInContext(packet.params.expression, realms[packet.params.contextId - 1]) } }; }
      catch (e) { result = { wasThrown: true, result: { description: String(e) } }; }
    }
    runtime.receive({ id: packet.id, result }, 'page');
  });
  for (let id = 1; id <= 2; id++) runtime.receive({ method: 'Runtime.executionContextCreated', params: { context: { id, type: 'normal', frameId: String(id), auxData: { isDefault: true, frameId: String(id) } } } }, 'page');
  const send = (data: unknown, source: any = windows[0]) => { for (const handler of handlers.get(2) ?? []) handler({ isTrusted: true, source, origin: 'https://a.example', data }); };
  return { runtime, windows, handlers, timers, send, expire: () => { now += 31000; for (const tick of timers.values()) tick(); } };
}
for (const platform of ['android', 'ios'] as const) test(`${platform}: capture maps source identity and cleans up`, async () => {
  const f = fixture(platform), monitor = f.runtime.createMessageMonitor('owner');
  await monitor.start(f.runtime.revision);
  assert.equal(f.handlers.size, 2);
  f.send({ hello: 'world' });
  const snapshot = await monitor.poll();
  assert.equal(snapshot.records.length, 1);
  assert.equal(snapshot.records[0].source, f.runtime.state().contexts[0].key);
  assert.equal(snapshot.records[0].receiver, f.runtime.state().contexts[1].key);
  assert.match(snapshot.records[0].data, /world/);
  assert.equal((await monitor.poll()).records.length, 0);
  await monitor.stop(); assert.equal(f.handlers.size, 0); f.runtime.close();
});
test('bounded queues report drops and retain safe cyclic payload previews', async () => {
  const f = fixture(), monitor = f.runtime.createMessageMonitor('owner');
  await monitor.start(0);
  const data: any = { text: 'x'.repeat(20000) }; data.self = data;
  Object.defineProperty(data, 'dangerous', { enumerable: true, get() { throw new Error('must not invoke'); } });
  for (let i = 0; i < 205; i++) f.send(data);
  const snapshot = await monitor.poll();
  assert.equal(snapshot.records.length, 200); assert.equal(snapshot.dropped, 5);
  assert.ok(snapshot.records[0].data.length <= 12000);
  assert.match(snapshot.records[0].data, /Circular/); assert.match(snapshot.records[0].data, /Accessor/);
  await monitor.stop(); f.runtime.close();
});
test('unknown senders stay unknown; frame position changes do not misattribute queued messages', async () => {
  const f = fixture(), monitor = f.runtime.createMessageMonitor('owner');
  await monitor.start(0); f.send('self', f.windows[1]); f.send('external', {});
  f.windows[0].frames.unshift({ frames: [] });
  const snapshot = await monitor.poll();
  assert.equal(snapshot.records[0].source, f.runtime.state().contexts[1].key);
  assert.equal(snapshot.records[1].source, null);
  await monitor.stop(); f.runtime.close();
});
test('navigation stops capture; expired listeners self-remove without a client', async () => {
  const f = fixture(), monitor = f.runtime.createMessageMonitor('owner');
  await monitor.start(0);
  f.runtime.receive({ method: 'Page.frameNavigated', params: { frame: { id: '1', url: 'new' } } }, 'page');
  assert.equal((await monitor.poll()).active, false); assert.equal(f.handlers.size, 0);
  await assert.rejects(monitor.start(0));
  await monitor.start(f.runtime.revision); f.expire(); assert.equal(f.handlers.size, 0);
  const expired = await monitor.poll(); assert.equal(expired.active, false); assert.equal(expired.unavailable.length, 2);
  await monitor.stop(); f.runtime.close();
});
test('independent sessions retain independent queues and listeners', async () => {
  const f = fixture(), a = f.runtime.createMessageMonitor('a'), b = f.runtime.createMessageMonitor('b');
  await a.start(0); await b.start(0);
  f.send('both');
  assert.equal((await a.poll()).records.length, 1);
  assert.equal((await b.poll()).records.length, 1);
  // Separate random page slots must survive stopping the other session.
  assert.equal(Object.getOwnPropertyNames(f.windows[0]).filter(k => k.startsWith('__udl_messages_')).length, 2);
  await a.stop(); assert.equal(Object.getOwnPropertyNames(f.windows[0]).filter(k => k.startsWith('__udl_messages_')).length, 1);
  f.send('only b');
  const remaining = await b.poll();
  assert.equal(remaining.active, true); assert.equal(remaining.records.length, 1);
  assert.equal((await a.poll()).records.length, 0);
  await b.stop(); f.runtime.close();
});
test('explicit finish returns the last queued messages before detaching', async () => {
  const f = fixture(), monitor = f.runtime.createMessageMonitor('owner');
  await monitor.start(0); f.send('last message');
  const result = await monitor.finish();
  assert.equal(result.active, false); assert.equal(result.records.length, 1);
  assert.match(result.records[0].data, /last message/); assert.equal(f.handlers.size, 0);
  f.runtime.close();
});
test('payload previews preserve arrays and explicitly represent special types', async () => {
  const f = fixture(), monitor = f.runtime.createMessageMonitor('owner');
  await monitor.start(0);
  f.send([1, 2]); f.send(new Map([['message', 'hello']])); f.send(new Date()); f.send(NaN);
  const rows = (await monitor.poll()).records;
  assert.equal(rows[0].data, '[1,2]');
  assert.match(rows[1].data, /Map/); assert.match(rows[2].data, /Date/); assert.match(rows[3].data, /NaN/);
  await monitor.stop(); f.runtime.close();
});

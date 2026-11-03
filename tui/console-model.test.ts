import { test, expect } from 'bun:test';
import { createConsoleModel } from './console-model';
const device = { id: 'a', name: 'Phone', platform: 'android' as const, state: 'connected', webview: { id: 'w', socket: 's', title: 'Page', url: 'https://example.test' } };
function fixture() {
  let revision = 1, calls = 0, released = 0;
  const runtime = { enable: async () => {}, state: () => ({ revision, connected: true, contexts: [{ key: 'main', name: '', url: '', frame: '', top: true }] }),
    evaluate: async () => { calls++; return { revision, value: { type: 'number', text: '2' }, exception: false, elapsed: 1 }; },
    properties: async () => ({ revision, children: [], total: 0 }), releaseOwner() {} };
  return { runtime, change: () => revision++, calls: () => calls, release: () => released++, released: () => released };
}
test('execution requires explicit context and never retries after navigation', async () => {
  const f = fixture(); const m = createConsoleModel(async () => ({ runtime: f.runtime, release: f.release }), () => {});
  await m.connect(device); await m.execute('1+1'); expect(f.calls()).toBe(0);
  m.chooseContext('main'); await m.execute('1+1'); expect(f.calls()).toBe(1); expect(m.results[0]?.value.text).toBe('2');
  f.change(); m.poll(); await m.execute('1+1'); expect(f.calls()).toBe(1); expect(m.context).toBe('');
  m.dispose(); expect(f.released()).toBe(1);
});
test('late acquisition after close is released', async () => {
  const f = fixture(); let resolve!: (value: any) => void;
  const m = createConsoleModel(() => new Promise(r => { resolve = r; }), () => {});
  const pending = m.connect(device); m.dispose(); resolve({ runtime: f.runtime, release: f.release }); await pending;
  expect(f.released()).toBe(1);
});
test('switching targets discards late results and invalidates old object handles', async () => {
  const f = fixture(); let finish!: (value: any) => void;
  f.runtime.evaluate = () => new Promise(r => { finish = r; });
  const m = createConsoleModel(async () => ({ runtime: f.runtime, release: f.release }), () => {});
  await m.connect(device); m.chooseContext('main'); const execution = m.execute('sideEffect()');
  await m.connect({ ...device, webview: { ...device.webview, id: 'other' } });
  finish({ revision: 1, exception: false, elapsed: 1, value: { type: 'object', text: 'Object', handle: 'old' } }); await execution;
  expect(m.results).toHaveLength(0); m.dispose(); expect(f.released()).toBe(2);
});
test('clearing results invalidates an in-flight property response', async () => {
  const f = fixture(); let finish!: (value: any) => void;
  f.runtime.evaluate = async () => ({ revision: 1, exception: false, elapsed: 1, value: { type: 'object', text: 'Object', handle: 'object' } });
  f.runtime.properties = () => new Promise(r => { finish = r; });
  const m = createConsoleModel(async () => ({ runtime: f.runtime, release: f.release }), () => {});
  await m.connect(device); m.chooseContext('main'); await m.execute('window');
  const result = m.results[0]!; const pending = m.inspect(result, result.value); m.clear();
  finish({ revision: 1, children: [], total: 0 });
  await expect(pending).rejects.toEqual({ code: 'consoleStale' }); m.dispose();
});

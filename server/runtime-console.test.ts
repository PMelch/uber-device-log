import assert from 'node:assert/strict';
import test from 'node:test';
import { RuntimeConsole } from './runtime-console.js';
import { createWebViewHub } from './webview-hub.js';

function fixture(platform: 'android' | 'ios' = 'android') {
  const runtime = new RuntimeConsole(platform, 30), sent: any[] = [];
  let reply: (packet: any) => any = () => ({});
  runtime.attach('page', p => { sent.push(p); const result = reply(p); if (result !== undefined) runtime.receive({ id: p.id, result }, 'page'); });
  const context = (id: number, frame = 'root') => runtime.receive({ method: 'Runtime.executionContextCreated', params: { context: { id, type: 'normal', frameId: frame, auxData: { isDefault: true, frameId: frame } } } }, 'page');
  return { runtime, sent, context, reply: (value: typeof reply) => { reply = value; } };
}
test('evaluation addresses the selected iframe, preserves primitives and releases handles', async () => {
  const f = fixture(); f.context(1); f.context(2, 'iframe');
  f.reply(p => p.method === 'Runtime.evaluate' ? { result: { type: 'number', value: 42 } } : {});
  const result = await f.runtime.evaluate(f.runtime.state().contexts[1].key, 0, 'window.answer');
  assert.equal(result.value.text, '42');
  assert.equal(f.sent.find(p => p.method === 'Runtime.evaluate').params.contextId, 2);
  assert.equal(f.sent.filter(p => p.method === 'Runtime.evaluate').length, 1);
  assert.ok(f.sent.some(p => p.method === 'Runtime.releaseObjectGroup'));
  f.runtime.close();
});
test('context destruction, ID reuse and in-flight navigation never retry a command', async () => {
  const f = fixture(); f.context(1);
  const key = f.runtime.state().contexts[0].key;
  f.runtime.receive({ method: 'Runtime.executionContextsCleared' }, 'page'); f.context(1);
  await assert.rejects(f.runtime.evaluate(key, 0, 'x++'), /consoleStale/);
  assert.equal(f.sent.length, 0);
  f.reply(p => {
    if (p.method === 'Runtime.evaluate') { f.runtime.receive({ method: 'Page.frameNavigated', params: { frame: { id: 'root', url: 'new' } } }, 'page'); return { result: { type: 'undefined' } }; }
    return {};
  });
  await assert.rejects(f.runtime.evaluate(f.runtime.state().contexts[0].key, 1, 'x++'), /consoleStale/);
  assert.equal(f.sent.filter(p => p.method === 'Runtime.evaluate').length, 1); f.runtime.close();
});
test('WebKit navigation removes old contexts; new iframe context replaces its predecessor', async () => {
  const f = fixture('ios'); f.context(1); f.context(2, 'child');
  f.runtime.receive({ method: 'Page.frameNavigated', params: { frame: { id: 'child', parentId: 'root', url: 'new' } } }, 'page');
  assert.equal(f.runtime.state().contexts.length, 1); f.context(3, 'child'); f.context(4, 'child');
  assert.equal(f.runtime.state().contexts.length, 2);
  f.runtime.receive({ method: 'Page.frameDetached', params: { frameId: 'child' } }, 'page');
  assert.equal(f.runtime.state().contexts.length, 1); f.runtime.close();
});
test('snapshot bounds recursion and leaves getters untouched; thrown values remain errors', async () => {
  const f = fixture('ios'); f.context(1);
  f.reply(p => p.method === 'Runtime.evaluate' ? { wasThrown: true, result: { type: 'object', description: 'Error', objectId: 'a' } } : p.method === 'Runtime.getProperties' ? { properties: [{ name: 'self', value: { type: 'object', objectId: 'a' } }, { name: 'secret', get: { type: 'function', objectId: 'getter' } }] } : {});
  const result = await f.runtime.evaluate(f.runtime.state().contexts[0].key, 0, 'throw new Error()');
  assert.equal(result.exception, true); assert.equal(result.value.children?.[0].value.truncated, true);
  assert.equal(result.value.children?.[1].value.type, 'accessor');
  assert.ok(!f.sent.some(p => p.method === 'Runtime.callFunctionOn')); f.runtime.close();
});
test('timeouts and busy runtimes do not dispatch duplicate evaluations', async () => {
  const f = fixture(); f.context(1); f.reply(p => p.method === 'Runtime.evaluate' ? undefined : {});
  const key = f.runtime.state().contexts[0].key;
  const first = f.runtime.evaluate(key, 0, 'run()');
  await assert.rejects(f.runtime.evaluate(key, 0, 'run()'), /consoleBusy/);
  await assert.rejects(first, /consoleTimeout/);
  assert.equal(f.sent.filter(p => p.method === 'Runtime.evaluate').length, 1); f.runtime.close();
});
test('runtime protocol errors are consumed without affecting capture; unrelated responses cannot resolve requests', async () => {
  const f = fixture(); f.context(1); f.reply(p => {
    if (p.method === 'Runtime.evaluate') {
      f.runtime.receive({ id: p.id, result: { result: { type: 'number', value: 99 } } }, 'other');
      f.runtime.receive({ id: p.id, error: { message: 'bad context' } }, 'page'); return undefined;
    } return {};
  });
  await assert.rejects(f.runtime.evaluate(f.runtime.state().contexts[0].key, 0, 'a'), /consoleUnavailable/);
  assert.equal(f.runtime.state().connected, true); f.runtime.close();
});
test('log capture and console share a transport until their last lease closes', async () => {
  let opens = 0, stops = 0; let deliver!: (value: any) => void;
  const hub = createWebViewHub(async (_device, message) => { opens++; deliver = message; return () => { stops++; }; });
  const device = { platform: 'ios' as const, id: 'phone', name: 'Phone', state: 'connected', webview: { id: '1', socket: 'PID:1', title: '', url: '' } };
  const logs: any[] = [];
  const capture = await hub(device, { message: m => logs.push(m), end: () => {} });
  const console = await hub(device); assert.equal(opens, 1); assert.equal(console.runtime, capture.runtime);
  console.release(); deliver({ message: 'still logging' }); assert.equal(logs.length, 1); assert.equal(stops, 0);
  capture.release(); await Promise.resolve(); assert.equal(stops, 1);
});

test('preview traversal has a total property and character budget', async () => {
  const f = fixture(); f.context(1);
  f.reply(p => p.method === 'Runtime.evaluate' ? { result: { type: 'object', objectId: 'root' } } : p.method === 'Runtime.getProperties' ? { result: Array.from({ length: 100 }, (_, i) => ({ name: String(i), value: { type: 'string', value: 'x'.repeat(20000) } })) } : {});
  const result = await f.runtime.evaluate(f.runtime.state().contexts[0].key, 0, 'large');
  assert.ok(JSON.stringify(result).length < 68000);
  assert.equal(result.value.truncated, true);
  assert.ok(result.value.children?.every(p => p.value.text.length <= 16000));
  f.runtime.close();
});

test('reconnecting retries failed context initialization while capture retains its runtime', async () => {
  const f = fixture('ios');
  let attempts = 0;
  f.reply(packet => {
    if (packet.method === 'Runtime.enable') {
      if (++attempts === 1) return undefined;
      f.context(7);
    }
    return packet.method === 'Page.getResourceTree' ? { frameTree: { frame: { id: 'root', url: 'https://example.test' } } } : {};
  });
  try {
    await f.runtime.enable();
    assert.equal(f.runtime.state().connected, true);
    assert.equal(f.runtime.state().contexts.length, 0);
    await f.runtime.enable();
    assert.equal(attempts, 2);
    assert.equal(f.sent.filter(packet => packet.method === 'Page.enable').length, 1);
    assert.equal(f.runtime.state().contexts.length, 1);
    assert.equal(f.runtime.state().contexts[0].top, true);
  } finally { f.runtime.close(); }
});

test('overlapping context initialization is shared and successful targets are not re-enabled', async () => {
  const f = fixture('ios');
  let enableId: number | undefined;
  let enableSent!: () => void;
  const sent = new Promise<void>(resolve => { enableSent = resolve; });
  f.reply(packet => {
    if (packet.method === 'Runtime.enable') { enableId = packet.id; enableSent(); return undefined; }
    return {};
  });
  try {
    const first = f.runtime.enable();
    const second = f.runtime.enable();
    await sent;
    f.context(1);
    f.runtime.receive({ id: enableId, result: {} }, 'page');
    await Promise.all([first, second]);
    await f.runtime.enable();
    assert.equal(f.sent.filter(packet => packet.method === 'Runtime.enable').length, 1);
    assert.equal(f.runtime.state().contexts.length, 1);
  } finally { f.runtime.close(); }
});

test('a failed newly attached target can initialize on reconnect without resetting healthy targets', async () => {
  const f = fixture('ios');
  let attempts = 0;
  try {
    await f.runtime.enable();
    f.runtime.attach('child', packet => {
      if (packet.method === 'Runtime.enable' && ++attempts === 1) {
        f.runtime.receive({ id: packet.id, error: { message: 'not ready' } }, 'child');
        return;
      }
      if (packet.method === 'Runtime.enable') f.runtime.receive({ method: 'Runtime.executionContextCreated', params: { context: { id: 2, type: 'normal', frameId: 'child' } } }, 'child');
      f.runtime.receive({ id: packet.id, result: {} }, 'child');
    }, false);
    await f.runtime.enable();
    await f.runtime.enable();
    assert.equal(attempts, 2);
    assert.equal(f.sent.filter(packet => packet.method === 'Runtime.enable').length, 1);
    assert.equal(f.runtime.state().contexts.length, 1);
  } finally { f.runtime.close(); }
});

test('late initialization completion cannot initialize a replacement target with the same ID', async () => {
  const f = fixture('ios');
  const first = f.runtime.enable();
  f.runtime.detach('page');
  const replacement: any[] = [];
  f.runtime.attach('page', packet => {
    replacement.push(packet);
    f.runtime.receive({ id: packet.id, result: packet.method === 'Page.getResourceTree' ? { frameTree: { frame: { id: 'replacement', url: 'https://new.example.test' } } } : {} }, 'page');
  });
  try {
    await Promise.all([first, f.runtime.enable()]);
    await f.runtime.enable();
    assert.deepEqual(replacement.map(packet => packet.method), ['Page.enable', 'Runtime.enable', 'Page.getResourceTree']);
  } finally { f.runtime.close(); }
});

test('WebKit context discovery enables Page before Runtime so existing frames are reported', async () => {
  const f = fixture('ios');
  let pageEnabled = false;
  f.reply(packet => {
    if (packet.method === 'Page.enable') pageEnabled = true;
    if (packet.method === 'Runtime.enable' && pageEnabled) { f.context(1); f.context(2, 'child'); }
    return packet.method === 'Page.getResourceTree' ? { frameTree: { frame: { id: 'root', url: 'https://example.test' }, childFrames: [{ frame: { id: 'child', url: 'https://frame.example.test' } }] } } : {};
  });
  try {
    await f.runtime.enable();
    const state = f.runtime.state();
    assert.equal(state.contexts.length, 2);
    assert.equal(state.contexts[0].top, true);
    assert.equal(state.contexts[1].top, false);
    assert.equal(state.contexts[1].url, 'https://frame.example.test');
    assert.equal(f.sent.filter(packet => packet.method === 'Page.enable').length, 1);
  } finally { f.runtime.close(); }
});

test('iOS retries failed Page setup before initializing Runtime', async () => {
  const f = fixture('ios');
  let pageAttempts = 0;
  f.reply(packet => {
    if (packet.method === 'Page.enable' && ++pageAttempts === 1) {
      f.runtime.receive({ id: packet.id, error: { message: 'page not ready' } }, 'page');
      return undefined;
    }
    if (packet.method === 'Runtime.enable') f.context(1);
    return {};
  });
  try {
    await f.runtime.enable();
    assert.equal(f.sent.filter(packet => packet.method === 'Runtime.enable').length, 0);
    await f.runtime.enable();
    assert.equal(pageAttempts, 2);
    assert.equal(f.runtime.state().contexts.length, 1);
  } finally { f.runtime.close(); }
});

test('iOS reconnect accepts Page already enabled after its first acknowledgement timed out', async () => {
  const f = fixture('ios');
  let attempts = 0;
  f.reply(packet => {
    if (packet.method === 'Page.enable') {
      if (++attempts === 1) return undefined;
      f.runtime.receive({ id: packet.id, error: { message: 'Page domain already enabled' } }, 'page');
      return undefined;
    }
    if (packet.method === 'Runtime.enable') f.context(1);
    return {};
  });
  try {
    await f.runtime.enable();
    assert.equal(f.runtime.state().contexts.length, 0);
    await f.runtime.enable();
    assert.equal(f.runtime.state().contexts.length, 1);
    assert.equal(f.sent.filter(packet => packet.method === 'Runtime.enable').length, 1);
  } finally { f.runtime.close(); }
});

for (const platform of ['android', 'ios'] as const) test(`${platform} contexts follow frame hierarchy regardless of arrival order`, async () => {
  const f = fixture(platform);
  f.context(3, 'nested'); f.context(2, 'child'); f.context(1);
  f.reply(p => p.method === (platform === 'ios' ? 'Page.getResourceTree' : 'Page.getFrameTree') ? {
    frameTree: { frame: { id: 'root' }, childFrames: [{ frame: { id: 'child', name: 'slotFrame' }, childFrames: [{ frame: { id: 'nested', name: 'game' } }] }] }
  } : {});
  await f.runtime.enable();
  assert.deepEqual(f.runtime.state().contexts.map(c => [c.frame, c.depth]), [['root', 0], ['child', 1], ['nested', 2]]);
  const key = f.runtime.state().contexts[2].key;
  f.runtime.receive({ method: 'Page.frameNavigated', params: { frame: { id: 'nested', parentId: 'root', name: 'game' } } }, 'page');
  if (platform === 'ios') f.context(4, 'nested');
  assert.equal(f.runtime.state().contexts.find(c => c.frame === 'nested')?.depth, 1);
  if (platform === 'android') assert.equal(f.runtime.state().contexts.find(c => c.frame === 'nested')?.key, key);
  f.runtime.close();
});

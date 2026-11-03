import { test, expect } from 'bun:test';
import { createLocalClient } from './local-client';
import type { Device, LogMessage } from '../shared/types';
const device: Device = { id: 'a', name: 'Phone', platform: 'android', state: 'connected' };
test('direct collectors merge source metadata and ignore late messages after deselection', async () => {
  let emit!: (m: LogMessage) => void;
  let stopped = 0;
  const logs: LogMessage[] = [];
  const client = createLocalClient({ logs: m => logs.push(...m), status() {} }, {
    list: async () => ({ devices: [device], warnings: [] }),
    open: async (_d, message) => { emit = message; return () => { stopped++; }; },
  });
  client.sync([device]); await Promise.resolve();
  emit({ timestamp: 'now', message: 'first' });
  await new Promise(r => setTimeout(r, 60));
  expect(logs[0]?.source?.deviceId).toBe('a');
  client.sync([]); emit({ timestamp: 'now', message: 'late' });
  client.close(); expect(stopped).toBe(1); expect(logs.length).toBe(1);
});
test('a collector resolving after shutdown is disposed', async () => {
  let resolve!: (stop: () => void) => void;
  let stopped = 0;
  const client = createLocalClient({ logs() {}, status() {} }, {
    list: async () => ({ devices: [], warnings: [] }),
    open: () => new Promise(r => { resolve = r; }),
  });
  client.sync([device]); client.close(); resolve(() => { stopped++; });
  await Promise.resolve(); expect(stopped).toBe(1);
});
test('terminal completion flushes final logs before stopping', async () => {
  const logs: LogMessage[] = [];
  const client = createLocalClient({ logs: m => logs.push(...m), status() {} }, {
    list: async () => ({ devices: [], warnings: [] }),
    open: async (_d, emit, end) => { emit({ timestamp: 'now', message: 'last' }); end('finished'); return () => {}; },
  });
  client.sync([device]); await Promise.resolve(); client.close();
  expect(logs.map(m => m.message)).toEqual(['last']);
});
test('ended selected collectors do not restart when another source is added', async () => {
  const opened: string[] = [];
  let end!: (reason: string) => void;
  const client = createLocalClient({ logs() {}, status() {} }, {
    list: async () => ({ devices: [], warnings: [] }),
    open: async (d, _emit, finish) => { opened.push(d.webview?.id || d.id); end = finish; return () => {}; },
  });
  client.sync([device]); await Promise.resolve(); end('disconnected');
  const view = { ...device, webview: { id: 'view', socket: 'socket', title: 'View', url: 'https://example.test' } };
  client.sync([device, view]); await Promise.resolve();
  expect(opened).toEqual(['a', 'view']); client.close();
});
test('nested discovered WebViews become independently selectable sources', async () => {
  const webview = { id: 'slot', socket: 'webview_devtools_remote_42', title: 'Slot', url: 'http://localhost/' };
  const client = createLocalClient({ logs() {}, status() {} }, {
    list: async () => ({ devices: [{ ...device, webviews: [webview] }], warnings: [] }),
    open: async () => () => {},
  });
  try {
    const sources = await client.sources();
    expect(sources).toHaveLength(2);
    expect(sources[0]?.webview).toBeUndefined();
    expect(sources[1]?.webview).toEqual(webview);
    expect(sources[1]?.id).toBe(device.id);
  } finally { client.close(); }
});
test('reselecting a source delivers fresh events and ignores old collector callbacks', async () => {
  const emitters: ((message: LogMessage) => void)[] = [];
  const ends: ((message: string) => void)[] = [];
  const received: string[] = [];
  const client = createLocalClient({ logs: messages => received.push(...messages.map(m => m.message)), status() {} }, {
    list: async () => ({ devices: [device], warnings: [] }),
    open: async (_device, emit, end) => { emitters.push(emit); ends.push(end); return () => {}; },
  });
  try {
    client.sync([device]); await Promise.resolve(); client.sync([]); client.sync([device]); await Promise.resolve();
    ends[0]!('old collector closed');
    emitters[0]!({ timestamp: 'now', message: 'stale' }); emitters[1]!({ timestamp: 'now', message: 'fresh' });
    await new Promise(r => setTimeout(r, 60)); expect(received).toEqual(['fresh']);
  } finally { client.close(); }
});

test('collector overflow reports one analysis gap before delivering the bounded batch', async () => {
  const events: string[] = []; let emit!: (row: LogMessage) => void;
  const client = createLocalClient({ logs: rows => events.push(`logs:${rows.length}`), gap: () => events.push('gap'), status() {} }, {
    list: async () => ({ devices: [], warnings: [] }), open: async (_device, message) => { emit = message; return () => {}; },
  });
  try {
    client.sync([device]); await Promise.resolve();
    for (let i = 0; i < 2100; i++) emit({ timestamp: 'now', message: String(i) });
    await Bun.sleep(60);
    expect(events).toEqual(['gap', 'logs:2000']);
  } finally { client.close(); }
});

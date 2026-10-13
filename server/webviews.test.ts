import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { connect, type Socket } from 'node:net';
import { PassThrough } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { discoverWebViews, openWebViewLogs, webViewMessage, webViewSockets, webViewTunnel } from './webviews';
import type { LogMessage } from '../shared/types';
import { selectedLogSource, webViewKey } from '../src/remembered-device';

const view = { socket: 'webview_devtools_remote_42', id: 'page-1', title: 'Checkout', url: 'https://example.test', pid: 42 };
function shell(text: string) { const stream = new PassThrough(); stream.end(text); return Promise.resolve(stream); }
function frame(value: unknown) {
  const data = Buffer.from(JSON.stringify(value));
  const header = data.length < 126 ? Buffer.from([0x81, data.length]) : Buffer.from([0x81, 126, data.length >> 8, data.length & 255]);
  return Buffer.concat([header, data]);
}
async function fixture(options: { commandError?: boolean; invalidHost?: boolean } = {}) {
  const sockets = new Set<Socket>();
  const commands: string[] = [];
  const requestedPaths: string[] = [];
  const server = createServer((req, res) => {
    requestedPaths.push(req.url!);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify([
      { ...view, type: 'page', webSocketDebuggerUrl: `ws://${options.invalidHost ? 'untrusted.example' : 'localhost:9222'}/devtools/page/page-1` },
      { id: 'worker', type: 'service_worker', webSocketDebuggerUrl: 'ws://localhost/devtools/page/worker' },
      { id: 'invalid', type: 'page', webSocketDebuggerUrl: 'ws://untrusted.example/api/private' },
    ]));
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('end', () => socket.destroy()); socket.once('close', () => sockets.delete(socket)); });
  server.on('upgrade', (request, socket) => {
    requestedPaths.push(request.url!);
    const accept = createHash('sha1').update(request.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.on('data', buffer => {
      if ((buffer[0] & 15) === 8) { socket.end(Buffer.from([0x88, 0])); return; }
      const length = buffer[1] & 127;
      if (length >= 126 || buffer.length < 6 + length) return;
      const mask = buffer.subarray(2, 6);
      const payload = Buffer.from(buffer.subarray(6, 6 + length));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
      const command = JSON.parse(payload.toString());
      commands.push(command.method);
      socket.write(frame(options.commandError ? { id: command.id, error: { message: 'Runtime disabled' } } : { id: command.id, result: {} }));
      if (!options.commandError) socket.write(frame({ method: 'Runtime.consoleAPICalled', params: { type: 'log', args: [{ type: 'string', value: 'hello from WebView' }], timestamp: 1000 } }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const client = {
    shell: () => shell('0000: 00000002 00000000 00010000 0001 01 0 @webview_devtools_remote_42\n'),
    openLocal: async (path: string) => { assert.equal(path, 'localabstract:webview_devtools_remote_42'); return connect(address.port, '127.0.0.1'); },
  };
  return { client, commands, sockets, requestedPaths, close: async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  } };
}

test('discovery finds only unique WebView sockets, preserving process-specific names', () => {
  assert.deepEqual(webViewSockets('x @webview_devtools_remote_42\nx @chrome_devtools_remote\nx @webview_devtools_remote_42\nx @webview_devtools_remote\nx @not_webview_devtools_remote_4\n'), ['webview_devtools_remote_42', 'webview_devtools_remote']);
});

test('ADB discovery enumerates pages and closes its temporary tunnel', async () => {
  const f = await fixture();
  try {
    assert.deepEqual(await discoverWebViews(f.client), [view]);
    await delay(30);
    assert.equal(f.sockets.size, 0);
    assert.deepEqual(f.requestedPaths, ['/json/list']);
  } finally { await f.close(); }
});

test('console mapping retains arguments, severity, timestamp and trace', () => {
  const result = webViewMessage({ method: 'Runtime.consoleAPICalled', params: { type: 'warning', timestamp: 1000,
    args: [{ type: 'string', value: 'unchanged <script>' }, { type: 'number', value: 0 }, { type: 'boolean', value: false }, { type: 'object', value: null }, { type: 'number', unserializableValue: 'NaN' }, { type: 'object', description: 'Object' }] } }, view);
  assert.deepEqual(result, { timestamp: '1970-01-01T00:00:01.000Z', message: 'unchanged <script> 0 false null NaN Object', level: 'W', tag: 'console.warning', pid: 42 });
  assert.equal(webViewMessage({ method: 'Runtime.consoleAPICalled', params: { type: 'error', args: [] } }, view)?.level, 'E');
  assert.equal(webViewMessage({ method: 'Runtime.consoleAPICalled', params: { type: 'debug', args: [] } }, view)?.level, 'D');
  assert.equal(webViewMessage({ method: 'Runtime.exceptionThrown', params: { exceptionDetails: { text: 'Uncaught', exception: { description: 'TypeError: broken\n    at app.js:1:2' } } } }, view)?.message, 'TypeError: broken\n    at app.js:1:2');
  assert.match(webViewMessage({ method: 'Runtime.consoleAPICalled', params: { type: 'trace', args: [], stackTrace: { callFrames: [{ functionName: 'run', url: 'app.js', lineNumber: 0, columnNumber: 1 }] } } }, view)!.message, /run \(app.js:1:2\)/);
  assert.equal(webViewMessage({ method: 'Runtime.executionContextCreated' }, view), undefined);
});

test('capture enables Runtime, ignores the advertised host, and stops sockets without emitting ended', async () => {
  const f = await fixture({ invalidHost: true });
  const messages: LogMessage[] = [];
  const ended: unknown[] = [];
  let stop: (() => void) | undefined;
  try {
    stop = await openWebViewLogs(f.client, view, message => messages.push(message), reason => ended.push(reason));
    await delay(50);
    assert.deepEqual(f.commands, ['Runtime.enable']);
    assert.equal(messages[0]?.message, 'hello from WebView');
    assert.deepEqual(f.requestedPaths, ['/json/list', '/devtools/page/page-1']);
    stop(); stop();
    await delay(30);
    assert.equal(f.sockets.size, 0);
    assert.deepEqual(ended, []);
  } finally { stop?.(); await f.close(); }
});

test('command failures and stale targets reject capture and clean up', async () => {
  const f = await fixture({ commandError: true });
  try {
    await assert.rejects(openWebViewLogs(f.client, view, () => {}, () => {}), /Runtime disabled/);
    await assert.rejects(openWebViewLogs(f.client, { ...view, id: 'gone' }, () => {}, () => {}), /no longer available/);
    await delay(30);
    assert.equal(f.sockets.size, 0);
  } finally { await f.close(); }
});

test('tunnels reject arbitrary local sockets', async () => {
  await assert.rejects(webViewTunnel({ shell: () => shell(''), openLocal: () => { throw new Error('Must not open'); } }, 'other_socket'), /Invalid WebView socket/);
});

test('parent and WebView selection stay distinct, disappearing targets never fall back to phone logs', () => {
  const device = { id: 'phone', platform: 'android' as const, name: 'Pixel', state: 'connected', webviews: [view, { ...view, id: 'page-2' }] };
  const child = webViewKey(device, view);
  assert.equal(selectedLogSource([device], 'android:phone'), device);
  assert.deepEqual(selectedLogSource([device], child)?.webview, view);
  assert.notEqual(child, webViewKey(device, device.webviews[1]));
  assert.equal(selectedLogSource([{ ...device, webviews: [] }], child), undefined);
});

test('stalled ADB shell acquisition has a deadline and destroys a late stream', async () => {
  let resolveShell!: (stream: PassThrough) => void;
  const pending = new Promise<PassThrough>(resolve => { resolveShell = resolve; });
  const client = { shell: () => pending, openLocal: () => { throw new Error('Must not open a tunnel'); } };
  await assert.rejects(discoverWebViews(client, 15), /timed out/);
  const late = new PassThrough();
  resolveShell(late);
  await delay(0);
  assert.equal(late.destroyed, true);
});

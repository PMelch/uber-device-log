import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, request } from 'node:http';
import { connect, type Socket } from 'node:net';
import { createHash } from 'node:crypto';
import { openAndroidInspector, inspectorFrontend } from './android-inspector';
const frontend = 'https://chrome-devtools-frontend.appspot.com/serve_rev/@0123456789abcdef/inspector.html';
const view = { id: 'page', socket: 'webview_devtools_remote_1', title: '', url: '' };
test('frontend trusts only device revision on approved host', () => {
  assert.equal(inspectorFrontend(frontend + '?ws=evil').toString(), frontend);
  for (const value of ['https://evil.test/serve_rev/@0123456/inspector.html', 'javascript:alert(1)', 'https://chrome-devtools-frontend.appspot.com/serve_rev/@main/inspector.html', undefined]) assert.throws(() => inspectorFrontend(value));
});
test('inspector bridge permits only tokenized approved-origin target upgrades and closes connections', async () => {
  const sockets = new Set<Socket>(); const paths: string[] = []; const origins: unknown[] = [];
  const upstream = createServer((_req, res) => res.end(JSON.stringify([{ ...view, type: 'page', devtoolsFrontendUrl: frontend, webSocketDebuggerUrl: 'ws://evil.test/devtools/page/page' }])));
  upstream.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  upstream.on('upgrade', (req, socket) => {
    paths.push(req.url!); origins.push(req.headers.origin);
    const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.on('data', () => {});
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const address = upstream.address(); assert.ok(address && typeof address !== 'string');
  const device = { shell: async () => { throw new Error('unused'); }, openLocal: async () => connect(address.port, '127.0.0.1') };
  const inspector = await openAndroidInspector(device, view);
  const ws = new URL('http://' + new URL(inspector.url).searchParams.get('ws'));
  const upgrade = (origin: string, path = ws.pathname, host = ws.host) => new Promise<{ status: number; socket?: Socket }>((resolve, reject) => {
    const req = request(ws, { path, headers: { Host: host, Origin: origin, Upgrade: 'websocket', Connection: 'Upgrade', 'Sec-WebSocket-Key': 'MDEyMzQ1Njc4OWFiY2RlZg==', 'Sec-WebSocket-Version': '13' } });
    req.on('upgrade', (_res, socket) => resolve({ status: 101, socket })); req.on('response', res => { res.resume(); resolve({ status: res.statusCode! }); }); req.on('error', reject); req.end();
  });
  let client: Socket | undefined;
  try {
    assert.equal(inspector.isActive(), false);
    assert.equal((await fetch(ws)).status, 403);
    assert.equal(inspector.isActive(), false);
    assert.equal((await upgrade('https://evil.test')).status, 403);
    assert.equal((await upgrade('https://chrome-devtools-frontend.appspot.com', '/json/list')).status, 403);
    assert.equal((await upgrade('https://chrome-devtools-frontend.appspot.com', ws.pathname, 'evil.test')).status, 403);
    const result = await upgrade('https://chrome-devtools-frontend.appspot.com'); client = result.socket;
    assert.equal(inspector.isActive(), true);
    assert.equal(result.status, 101); assert.deepEqual(paths, ['/devtools/page/page']); assert.deepEqual(origins, [undefined]);
    client!.destroy();
    const deadline = Date.now() + 1000;
    while (inspector.isActive() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(inspector.isActive(), false, 'closing the frontend releases its active slot');
    const reopened = await upgrade('https://chrome-devtools-frontend.appspot.com'); client = reopened.socket;
    assert.equal(inspector.isActive(), true);
    const disconnected = new Promise<void>(resolve => client!.once('close', resolve));
    inspector.close(); await disconnected;
    assert.equal(inspector.isActive(), false);
  } finally { inspector.close(); client?.destroy(); for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => upstream.close(() => resolve())); }
});

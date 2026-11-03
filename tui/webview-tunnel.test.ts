import { test, expect } from 'bun:test';
import { createServer, connect } from 'node:net';
import { webViewTunnel, targets } from '../server/webviews';

test('WebView tunnel retains requests arriving before the asynchronous ADB socket opens', async () => {
  const sockets = new Set<ReturnType<typeof connect>>();
  const upstream = createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    socket.once('data', () => socket.end('HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n[]'));
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const port = (upstream.address() as { port: number }).port;
  const tunnel = await webViewTunnel({
    shell: async () => { throw new Error('unused'); },
    openLocal: async () => { await new Promise(r => setTimeout(r, 100)); return connect(port, '127.0.0.1'); },
  }, 'webview_devtools_remote_42');
  try { expect(await targets(tunnel.origin)).toEqual([]); }
  finally { tunnel.close(); for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => upstream.close(() => resolve())); }
}, 10000);

test('device adapter imports under the Bun source runner', async () => {
  const adapter = await import('../server/devices');
  expect(typeof adapter.listDevices).toBe('function');
});

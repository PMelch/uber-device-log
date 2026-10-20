import { createServer, request } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { Duplex } from 'node:stream';
import type { WebView } from '../shared/types.js';
import { targetPath, targets, webViewTunnel, type WebViewDevice } from './webviews.js';

const frontendOrigin = 'https://chrome-devtools-frontend.appspot.com';
/** Trust only a revision advertised by this device, never an arbitrary frontend URL. */
export function inspectorFrontend(advertised: unknown): URL {
  if (typeof advertised !== 'string') throw new Error('WebView does not advertise Chrome DevTools');
  const url = new URL(advertised);
  if (!['http:', 'https:'].includes(url.protocol) || url.hostname !== 'chrome-devtools-frontend.appspot.com' ||
      !/^\/serve_rev\/@[a-f\d]{7,64}\/(?:inspector|devtools_app)\.html$/.test(url.pathname)) {
    throw new Error('WebView does not advertise a supported Chrome DevTools revision');
  }
  return new URL(url.pathname, frontendOrigin);
}

/** A short-lived, target-only bridge. Discovery stays private to the raw ADB tunnel. */
export async function openAndroidInspector(device: WebViewDevice, view: WebView) {
  const tunnel = await webViewTunnel(device, view.socket);
  try {
    const target = (await targets(tunnel.origin)).find(item => item?.id === view.id && item.type === 'page');
    const path = target && targetPath(target);
    if (!path) throw new Error('WebView target is no longer available');
    const frontend = inspectorFrontend(target.devtoolsFrontendUrl);
    const tokenPath = `/${randomUUID()}`;
    const streams = new Set<Duplex>();
    const frontendConnections = new Set<Duplex>();
    const pending = new Set<ReturnType<typeof request>>();
    let closed = false;
    const server = createServer((_req, res) => { res.writeHead(403); res.end(); });
    const track = (socket: Duplex) => { streams.add(socket); socket.on('error', () => socket.destroy()); socket.once('close', () => streams.delete(socket)); };
    server.on('connection', track);
    server.on('upgrade', (req, socket, head) => {
      const address = server.address();
      if (closed || !address || typeof address === 'string' || req.url !== tokenPath ||
          req.headers.host !== `127.0.0.1:${address.port}` || req.headers.origin !== frontendOrigin ||
          req.headers.upgrade?.toLowerCase() !== 'websocket') {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
      }
      // Do not forward the hosted frontend Origin: Chromium rejects remote origins.
      const upstream = request(tunnel.origin + path, { headers: {
        Upgrade: 'websocket', Connection: 'Upgrade',
        'Sec-WebSocket-Key': req.headers['sec-websocket-key'] ?? '',
        'Sec-WebSocket-Version': '13',
      } });
      pending.add(upstream);
      upstream.setTimeout(5000, () => upstream.destroy());
      socket.once('close', () => { upstream.destroy(); pending.delete(upstream); });
      upstream.on('error', () => { pending.delete(upstream); socket.destroy(); });
      upstream.on('response', response => { response.resume(); socket.destroy(); pending.delete(upstream); });
      upstream.on('upgrade', (response, remote, remoteHead) => {
        pending.delete(upstream);
        upstream.setTimeout(0);
        remote.setTimeout(0);
        if (closed || socket.destroyed) { remote.destroy(); return; }
        track(remote);
        frontendConnections.add(socket);
        socket.once('close', () => frontendConnections.delete(socket));
        socket.once('close', () => remote.destroy());
        remote.once('close', () => socket.destroy());
        socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${response.headers['sec-websocket-accept']}\r\n\r\n`);
        if (remoteHead.length) socket.write(remoteHead);
        if (head.length) remote.write(head);
        socket.pipe(remote).pipe(socket);
      });
      upstream.end();
    });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Inspector bridge unavailable');
    frontend.searchParams.set('ws', `127.0.0.1:${address.port}${tokenPath}`);
    const close = () => {
      if (closed) return;
      closed = true;
      for (const socket of streams) socket.destroy();
      for (const request of pending) request.destroy();
      server.close(); tunnel.close();
    };
    return { url: frontend.toString(), close, isActive: () => !closed && frontendConnections.size > 0 };
  } catch (error) { tunnel.close(); throw error; }
}

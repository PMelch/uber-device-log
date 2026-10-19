import { createServer } from 'node:net';
import type { Duplex } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import type { LogMessage, WebView } from '../shared/types.js';
import { notification, type Notification } from '../shared/notifications.js';

export interface WebViewDevice {
  shell(command: string): PromiseLike<Duplex>;
  openLocal(path: string): PromiseLike<Duplex>;
}

const discoveryTimeout = 2500;
const maxResponse = 1024 * 1024;
const maxWebViewSockets = 32;
// A /proc/net/unix row contains a short header and a Unix socket name. Keep
// partial rows bounded too, even if a malformed stream never sends a newline.
const maxSocketLine = 4096;

export function webViewSockets(text: string): string[] {
  return [...new Set([...text.matchAll(/@((?:webview_devtools_remote)(?:_[\w.-]+)?)\s*$/gm)].map(match => match[1]))].slice(0, maxWebViewSockets);
}

async function acquireStream(pending: PromiseLike<Duplex>, timeout: number): Promise<Duplex> {
  return new Promise((resolve, reject) => {
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      reject(new Error('WebView discovery timed out'));
    }, timeout);
    void Promise.resolve(pending).then(stream => {
      clearTimeout(timer);
      if (expired) stream.destroy();
      else resolve(stream);
    }, error => { clearTimeout(timer); reject(error); });
  });
}

async function readWebViewSockets(stream: Duplex, timeout: number): Promise<string[]> {
  const sockets = new Set<string>();
  const decoder = new StringDecoder('utf8');
  let line = '';
  let oversized = false;
  function finishLine() {
    if (!oversized) for (const socket of webViewSockets(line)) sockets.add(socket);
    line = '';
    oversized = false;
  }
  function consume(text: string) {
    let start = 0;
    while (start < text.length && sockets.size < maxWebViewSockets) {
      const newline = text.indexOf('\n', start);
      const end = newline === -1 ? text.length : newline;
      if (!oversized) {
        if (line.length + end - start > maxSocketLine) { line = ''; oversized = true; }
        else line += text.slice(start, end);
      }
      if (newline === -1) break;
      finishLine();
      start = newline + 1;
    }
  }
  const timer = setTimeout(() => stream.destroy(new Error('WebView discovery timed out')), timeout);
  try {
    for await (const chunk of stream) {
      consume(typeof chunk === 'string' ? chunk : decoder.write(chunk));
      if (sockets.size === maxWebViewSockets) return [...sockets];
    }
    consume(decoder.end());
    finishLine();
    return [...sockets];
  } finally { clearTimeout(timer); stream.destroy(); }
}

/** No persistent adb forwards. Each tunnel owns its ADB and local connections. */
export async function webViewTunnel(device: WebViewDevice, socket: string) {
  if (!/^webview_devtools_remote(?:_[\w.-]+)?$/.test(socket)) throw new Error('Invalid WebView socket');
  let closed = false;
  const streams = new Set<Duplex>();
  const server = createServer(local => {
    streams.add(local);
    local.on('error', () => local.destroy());
    const timer = setTimeout(() => local.destroy(), discoveryTimeout);
    local.once('close', () => { clearTimeout(timer); streams.delete(local); });
    void Promise.resolve(device.openLocal(`localabstract:${socket}`)).then(remote => {
      clearTimeout(timer);
      if (closed || local.destroyed) { remote.destroy(); return; }
      streams.add(remote);
      remote.on('error', () => { remote.destroy(); local.destroy(); });
      remote.once('close', () => { streams.delete(remote); local.destroy(); });
      local.once('close', () => remote.destroy());
      local.pipe(remote).pipe(local);
    }).catch(() => local.destroy());
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('WebView tunnel unavailable');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close() {
      if (closed) return;
      closed = true;
      for (const stream of streams) stream.destroy();
      streams.clear();
      server.close();
    },
  };
}

interface Target { id?: string; type?: string; title?: string; url?: string; webSocketDebuggerUrl?: string }
async function targets(origin: string): Promise<Target[]> {
  const response = await fetch(`${origin}/json/list`, { signal: AbortSignal.timeout(discoveryTimeout), redirect: 'error' });
  if (!response.ok) throw new Error(`WebView discovery HTTP ${response.status}`);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxResponse) throw new Error('WebView discovery response too large');
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const data: unknown = JSON.parse(text);
  if (!Array.isArray(data)) throw new Error('Invalid WebView target list');
  return data;
}

function targetPath(target: Target): string | undefined {
  if (typeof target.webSocketDebuggerUrl !== 'string') return;
  try {
    const url = new URL(target.webSocketDebuggerUrl);
    if (url.protocol !== 'ws:' || !/^\/devtools\/page\/[^/?#]+$/.test(url.pathname) || url.search || url.hash) return;
    // The advertised host can be a device-local port. Only use the path.
    return url.pathname;
  } catch { return; }
}

export async function discoverWebViews(device: WebViewDevice, timeout = discoveryTimeout): Promise<WebView[]> {
  const sockets = await readWebViewSockets(await acquireStream(device.shell('cat /proc/net/unix'), timeout), timeout);
  const views: WebView[] = [];
  // Small batches bound simultaneous ADB connections, even with many processes.
  for (let offset = 0; offset < sockets.length; offset += 4) {
    await Promise.all(sockets.slice(offset, offset + 4).map(async socket => {
      const tunnel = await webViewTunnel(device, socket);
      try {
        for (const target of await targets(tunnel.origin)) {
          if (target?.type !== 'page' || typeof target.id !== 'string' || !target.id || !targetPath(target)) continue;
          const pid = /_(\d+)$/.exec(socket)?.[1];
          views.push({ id: target.id, socket, title: typeof target.title === 'string' ? target.title : '',
            url: typeof target.url === 'string' ? target.url : '', ...(pid ? { pid: Number(pid) } : {}) });
        }
      } catch { /* A closing/inaccessible WebView must not hide other targets. */ }
      finally { tunnel.close(); }
    }));
  }
  return views.sort((a, b) => `${a.socket}:${a.id}`.localeCompare(`${b.socket}:${b.id}`));
}

interface RemoteObject { type?: string; value?: unknown; unserializableValue?: string; description?: string }
interface CallFrame { functionName?: string; url?: string; lineNumber?: number; columnNumber?: number }
interface CdpEvent {
  method?: string;
  params?: {
    type?: string; args?: RemoteObject[]; timestamp?: number;
    stackTrace?: { callFrames?: CallFrame[] };
    exceptionDetails?: { text?: string; exception?: RemoteObject; stackTrace?: { callFrames?: CallFrame[] } };
  };
}
function argument(object: RemoteObject): string {
  if (Object.hasOwn(object, 'value')) return typeof object.value === 'string' ? object.value : JSON.stringify(object.value) ?? String(object.value);
  return object.unserializableValue ?? object.description ?? object.type ?? 'undefined';
}
export function webViewMessage(event: CdpEvent, view: WebView): LogMessage | undefined {
  const params = event.params;
  if (!params || !['Runtime.consoleAPICalled', 'Runtime.exceptionThrown'].includes(event.method ?? '')) return;
  const exception = params.exceptionDetails;
  const type = event.method === 'Runtime.exceptionThrown' ? 'exception' : params.type ?? 'log';
  let message = exception ? (exception.exception ? argument(exception.exception) : exception.text ?? '')
    : (params.args ?? []).map(argument).join(' ');
  if (type === 'trace') {
    message += (params.stackTrace?.callFrames ?? []).map(frame => `\n    at ${frame.functionName || '<anonymous>'} (${frame.url ?? ''}:${(frame.lineNumber ?? 0) + 1}:${(frame.columnNumber ?? 0) + 1})`).join('');
  }
  const timestamp = params.timestamp;
  const date = typeof timestamp === 'number' && Number.isFinite(timestamp) ? new Date(timestamp) : new Date();
  return { timestamp: Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString(),
    message, level: type === 'exception' || type === 'error' || type === 'assert' ? 'E' : type === 'warning' ? 'W' : type === 'debug' ? 'D' : 'I',
    tag: `console.${type}`, pid: view.pid };
}

export async function openWebViewLogs(device: WebViewDevice, view: WebView,
  onMessage: (message: LogMessage) => void, onEnd: (reason: Notification | string) => void): Promise<() => void> {
  const tunnel = await webViewTunnel(device, view.socket);
  let ws: WebSocket | undefined;
  let stopped = false;
  const stop = () => { if (stopped) return; stopped = true; ws?.close(); tunnel.close(); };
  try {
    const target = (await targets(tunnel.origin)).find(target => target?.id === view.id && target.type === 'page');
    const path = target && targetPath(target);
    if (!path) throw new Error('WebView target is no longer available');
    ws = new WebSocket(tunnel.origin.replace('http:', 'ws:') + path);
    const connection = ws;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('WebView console connection timed out')), 5000);
      const finish = (error?: Error) => { clearTimeout(timer); error ? reject(error) : resolve(); };
      connection.addEventListener('open', () => connection.send(JSON.stringify({ id: 1, method: 'Runtime.enable' })));
      connection.addEventListener('message', event => {
        if (stopped) return;
        try {
          const data = JSON.parse(String(event.data));
          if (data.id === 1) {
            if (data.error) finish(new Error(data.error.message ?? 'Runtime.enable failed'));
            else finish();
          }
          const message = webViewMessage(data, view);
          if (message) onMessage(message);
        } catch { /* Ignore malformed protocol events. */ }
      });
      connection.addEventListener('error', () => {
        finish(new Error('WebView console connection failed'));
        if (!stopped) onEnd(notification('webviewEnded'));
        stop();
      });
      connection.addEventListener('close', () => {
        finish(new Error('WebView console connection closed'));
        if (!stopped) onEnd(notification('webviewEnded'));
        stop();
      });
    });
    return stop;
  } catch (error) { stop(); throw error; }
}

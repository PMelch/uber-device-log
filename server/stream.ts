import type { ServerResponse } from 'node:http';
import type { Device, LogMessage } from '../shared/types.js';
import type { OpenLogs, Stop } from './devices.js';

import { notification, type Notification } from '../shared/notifications.js';

// A connection owns one collector. Closing the tab or changing selection closes
// the collector, including one that resolves after the browser has gone away.
export function streamLogs(response: ServerResponse, device: Device, open: OpenLogs): Stop {
  let closed = false;
  let stopCollector: Stop | undefined;
  let queue: LogMessage[] = [];
  let dropped = 0;
  let blocked = false;

  function send(event: string, data: unknown) {
    if (!closed) blocked = !response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
  function close() {
    if (closed) return;
    closed = true;
    clearInterval(flushTimer);
    clearInterval(heartbeat);
    clearTimeout(connectTimeout);
    queue = [];
    stopCollector?.();
    if (!response.destroyed) response.end();
  }
  function finish(message: Notification | string) {
    if (closed) return;
    send('stopped', typeof message === 'string' ? { message } : message);
    close();
  }
  const flushTimer = setInterval(() => {
    if (closed || blocked) return;
    if (dropped) {
      const count = dropped;
      dropped = 0;
      send('status', notification('streamSkipped', { count }));
      if (blocked) return;
    }
    if (queue.length) send('logs', queue.splice(0, 100));
  }, 100);
  const heartbeat = setInterval(() => {
    if (!blocked && !closed) blocked = !response.write(': heartbeat\n\n');
  }, 15000);
  const connectTimeout = setTimeout(() => finish(notification('streamTimeout')), 15000);
  response.on('drain', () => { blocked = false; });
  response.on('close', close);
  response.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  response.flushHeaders();

  void open(device, message => {
    if (closed) return;
    if (queue.length === 1000) { queue.shift(); dropped++; }
    queue.push({ ...message, message: message.message.slice(0, 16384) });
  }, finish).then(stop => {
    clearTimeout(connectTimeout);
    if (closed) stop();
    else {
      stopCollector = stop;
      send('status', notification('streamLive'));
    }
  }).catch(error => finish(notification('streamCannotRead', { detail: error instanceof Error ? error.message : String(error) })));
  return close;
}

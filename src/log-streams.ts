import type { Device, LogMessage } from '../shared/types';
import type { UiMessage } from './i18n';
export interface LogStream { addEventListener(type: string, callback: (event: { data: string }) => void): void; onerror: (() => void) | null; close(): void }
export interface StreamSource { key: string; device: Device }

/**
 * Reconcile one EventSource per enabled source without restarting unaffected ones.
 * Failed records remain registered but closed until removed/readded or reconnecting;
 * explicitly closing EventSource suppresses its native automatic retry. Identity
 * guards prevent stale callbacks from an old connection reaching current state.
 */
export function createLogStreams(callbacks: {
  logs: (source: StreamSource, messages: LogMessage[]) => void;
  status: (source: StreamSource, message: UiMessage, live: boolean) => void;
}, connect: (url: string) => LogStream) {
  const streams = new Map<string, { stream: LogStream; closed: boolean }>();
  function close(key: string) {
    const record = streams.get(key);
    if (record && !record.closed) { record.closed = true; record.stream.close(); }
    streams.delete(key);
  }
  return {
    sync(sources: StreamSource[]) {
      const keys = new Set(sources.map(source => source.key));
      for (const key of streams.keys()) if (!keys.has(key)) close(key);
      for (const source of sources) {
        if (streams.has(source.key)) continue;
        const device = source.device;
        const query = new URLSearchParams({ platform: device.platform, id: device.id });
        if (device.webview) { query.set('webviewSocket', device.webview.socket); query.set('webviewId', device.webview.id); }
        const stream = connect(`/api/logs?${query}`);
        const record = { stream, closed: false };
        streams.set(source.key, record);
        const current = () => streams.get(source.key) === record && !record.closed;
        function finish(message: UiMessage) {
          if (!current()) return;
          record.closed = true;
          stream.close();
          callbacks.status(source, message, false);
        }
        stream.addEventListener('logs', event => {
          if (!current()) return;
          try { callbacks.logs(source, JSON.parse(event.data)); }
          catch { finish({ code: 'connectionLost' }); }
        });
        stream.addEventListener('status', event => {
          if (!current()) return;
          try { callbacks.status(source, JSON.parse(event.data), true); }
          catch { finish({ code: 'connectionLost' }); }
        });
        stream.addEventListener('stopped', event => {
          try { finish(JSON.parse(event.data)); }
          catch { finish({ code: 'connectionLost' }); }
        });
        stream.onerror = () => finish({ code: 'connectionLost' });
      }
    },
    close() { for (const key of streams.keys()) close(key); },
  };
}

/**
 * Coalesce deliveries for 50 ms; optionally compact when pending exceeds 2× capacity.
 * Capture the displayed snapshot before flushing arrivals into the live buffer.
 * Flush before stop/source toggles; clear when discarding the view or unmounting.
 */
export function createLogBatcher<T>(commit: (rows: T[]) => void,
  limit?: { capacity: () => number; compact: (rows: T[], capacity: number) => T[] }) {
  let pending: T[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  function cancel() { if (timer !== undefined) clearTimeout(timer); timer = undefined; }
  function flush() {
    cancel();
    const rows = pending;
    pending = [];
    if (rows.length) commit(rows);
  }
  return {
    push(rows: T[]) {
      for (const row of rows) pending.push(row);
      if (limit && pending.length > limit.capacity() * 2) pending = limit.compact(pending, limit.capacity());
      if (pending.length && timer === undefined) timer = setTimeout(flush, 50);
    },
    flush,
    clear() { cancel(); pending = []; },
  };
}

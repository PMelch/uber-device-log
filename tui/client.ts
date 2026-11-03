import { EventSource } from 'eventsource';
import type { Device, DeviceList, LogMessage } from '../shared/types';
import type { UiMessage } from '../src/i18n';
import { createLogStreams, type LogStream } from '../src/log-streams';

/** Reuse the browser's explicit retry and stale-stream ownership semantics. */
export function createTuiClient(endpoint: string, callbacks: {
  logs(messages: LogMessage[]): void;
  status(message: UiMessage | string, live: boolean): void;
}) {
  const url = new URL(endpoint);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Use a loopback HTTP origin, for example http://127.0.0.1:4310.');
  }
  let closed = false;
  let capturing = false;
  const pending = new Set<AbortController>();
  const streams = createLogStreams({
    logs(source, messages) {
      callbacks.logs(messages.map(message => ({ ...message, source: {
        key: source.key, name: source.device.webview?.title || source.device.name,
        platform: source.device.platform, deviceId: source.device.id,
        ...(source.device.webview ? { webview: source.device.webview } : {}),
      } })));
    },
    status(_source, message, live) { capturing = live; callbacks.status(message, live); },
  }, path => {
    const source = new EventSource(new URL(path, url).href);
    const adapter: LogStream = {
      onerror: null,
      addEventListener(type, callback) { source.addEventListener(type, event => callback({ data: (event as MessageEvent<string>).data })); },
      close() { source.close(); },
    };
    source.onerror = () => adapter.onerror?.();
    return adapter;
  });
  return {
    async sources(): Promise<Device[]> {
      if (closed) return [];
      const controller = new AbortController(); pending.add(controller);
      try {
        const response = await fetch(new URL('/api/devices', url), { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]), redirect: 'error' });
        if (!response.ok) throw new Error(`Device discovery: HTTP ${response.status}`);
        const result = await response.json() as DeviceList;
        if (closed) return [];
        if (result.warnings.length) callbacks.status(result.warnings[0]!, capturing);
        return result.devices.filter(device => device.state === 'connected').flatMap(device => [device,
          ...(device.webviews ?? []).map(webview => ({ ...device, webview }))]);
      } finally { pending.delete(controller); }
    },
    select(device: Device) {
      if (closed) return;
      streams.close();
      capturing = false;
      callbacks.status({ code: 'waiting' }, false);
      streams.sync([{ key: JSON.stringify([device.platform, device.id, device.webview?.socket, device.webview?.id]), device }]);
    },
    close() { closed = true; streams.close(); for (const controller of pending) controller.abort(); pending.clear(); },
  };
}

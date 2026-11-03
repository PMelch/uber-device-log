import type { Device, DeviceList, LogMessage } from '../shared/types';
import type { OpenLogs, Stop } from '../server/devices';
import type { UiMessage } from '../src/i18n';
export const sourceKey = (device: Device) => JSON.stringify([device.platform, device.id, device.webview?.socket, device.webview?.id]);

/** Own collectors directly; no HTTP listener or SSE connection is created. */
export function createLocalClient(callbacks: {
  logs(messages: LogMessage[]): void;
  status(message: UiMessage | string, live: boolean): void;
}, dependencies: { list(): Promise<DeviceList>; open: OpenLogs }) {
  const active = new Map<string, { stop?: Stop; timer?: ReturnType<typeof setTimeout>; live: boolean; ended?: boolean }>();
  let closed = false;
  let queue: LogMessage[] = [];
  const flush = setInterval(() => { if (queue.length) callbacks.logs(queue.splice(0)); }, 50);
  const live = () => [...active.values()].some(entry => entry.live);
  function remove(key: string) {
    const entry = active.get(key);
    active.delete(key); clearTimeout(entry?.timer); entry?.stop?.();
    queue = queue.filter(message => message.source?.key !== key);
  }
  return {
    async sources() {
      const result = await dependencies.list();
      if (closed) return [];
      if (result.warnings[0]) callbacks.status(result.warnings[0], live());
      return result.devices.filter(d => d.state === 'connected').flatMap(d => [d, ...(d.webviews ?? []).map(webview => ({ ...d, webview }))]);
    },
    sync(devices: Device[]) {
      if (closed) return;
      const desired = new Set(devices.map(sourceKey));
      for (const key of active.keys()) if (!desired.has(key)) remove(key);
      for (const device of devices) {
        const key = sourceKey(device);
        if (active.has(key)) continue;
        const entry: { stop?: Stop; timer?: ReturnType<typeof setTimeout>; live: boolean; ended?: boolean } = { live: false };
        active.set(key, entry);
        const owned = () => !closed && active.get(key) === entry && !entry.ended;
        const finish = (message: UiMessage | string) => {
          if (!owned()) return;
          const final = queue.filter(record => record.source?.key === key);
          if (final.length) callbacks.logs(final);
          entry.ended = true; entry.live = false; clearTimeout(entry.timer); entry.stop?.(); entry.stop = undefined;
          queue = queue.filter(record => record.source?.key !== key);
          callbacks.status(message, live());
        };
        entry.timer = setTimeout(() => finish({ code: 'streamTimeout' }), 15000);
        void dependencies.open(device, message => {
          if (!owned()) return;
          if (queue.length >= 2000) queue.shift();
          queue.push({ ...message, source: { key, name: device.webview?.title || device.name, platform: device.platform,
            deviceId: device.id, ...(device.webview ? { webview: device.webview } : {}) } });
        }, finish).then(stop => {
          clearTimeout(entry.timer);
          if (!owned()) { stop(); return; }
          entry.stop = stop; entry.live = true;
          callbacks.status({ code: device.webview ? 'webviewLive' : 'streamLive' }, live());
        }).catch(error => finish({ code: 'streamCannotRead', params: { detail: String(error) } }));
      }
      callbacks.status({ code: active.size ? 'waiting' : 'selectDevice' }, live());
    },
    close() { closed = true; clearInterval(flush); for (const key of active.keys()) remove(key); queue = []; },
  };
}

import type { Device, LogMessage } from '../shared/types.js';
import type { Notification } from '../shared/notifications.js';
import { RuntimeConsole } from './runtime-console.js';

type Listener = { message: (value: LogMessage) => void; end: (reason: Notification | string) => void };
type Open = (device: Device, message: Listener['message'], end: Listener['end'], runtime: RuntimeConsole) => Promise<() => void>;
/** One inspector owner per page, shared by capture and execution consumers. */
export function createWebViewHub(open: Open) {
  const entries = new Map<string, { runtime: RuntimeConsole; listeners: Set<Listener>; ready: Promise<() => void>; leases: number }>();
  return async (device: Device, listener?: Listener) => {
    if (device.platform !== 'android' && device.platform !== 'ios') throw new Error('This source does not support JavaScript.');
    const key = JSON.stringify([device.platform, device.id, device.webview?.socket, device.webview?.id]);
    let entry = entries.get(key);
    if (!entry) {
      const runtime = new RuntimeConsole(device.platform), listeners = new Set<Listener>();
      const current = { runtime, listeners, ready: Promise.resolve(() => {}), leases: 0 };
      entry = current;
      entries.set(key, current);
      current.ready = open(device, value => { for (const l of listeners) l.message(value); }, reason => {
        runtime.close();
        if (entries.get(key) === current) entries.delete(key);
        for (const l of listeners) l.end(reason);
      }, runtime);
    }
    const owned = entry;
    owned.leases++;
    if (listener) owned.listeners.add(listener);
    let released = false;
    const release = () => {
      if (released) return; released = true;
      if (listener) owned.listeners.delete(listener);
      if (--owned.leases === 0) {
        if (entries.get(key) === owned) entries.delete(key);
        owned.runtime.close();
        void owned.ready.then(stop => stop(), () => {});
      }
    };
    try { await owned.ready; return { runtime: owned.runtime, release }; }
    catch (error) { release(); throw error; }
  };
}

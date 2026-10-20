import { PROVIDER_API_VERSION, type LogProvider, type ProviderTarget, type CaptureSession, type CaptureSink } from '../shared/providers.js';
import type { Device, DeviceList } from '../shared/types.js';
import type { OpenLogs, Stop } from './devices.js';

/** Transport locator is private to built-ins, never part of the generic contract. */
export interface BuiltinTarget extends ProviderTarget { readonly device: Device }
const providerId = (device: Device) => 'builtin.' + device.platform + '.' + (device.webview ? 'webview' : device.platform === 'android' ? 'logcat' : 'syslog');

export function providerTarget(device: Device): BuiltinTarget {
  const id = providerId(device);
  return {
    providerId: id,
    id: JSON.stringify([id, device.id, ...(device.webview ? [device.webview.socket, device.webview.id] : [])]),
    parentId: device.webview ? providerTarget({ ...device, webview: undefined }).id : undefined,
    name: device.webview?.title || device.name,
    state: device.state,
    capabilities: { logs: true, ...(device.webview ? { javascript: { sideEffects: true as const, requiresExplicitRequest: true as const } } : {}) },
    device,
  };
}

function openSession(open: OpenLogs, target: BuiltinTarget, sink: CaptureSink, signal?: AbortSignal): CaptureSession {
  let closed = false;
  let stop: Stop | undefined;
  const dispose = () => {
    if (closed) return;
    closed = true;
    signal?.removeEventListener('abort', dispose);
    const release = stop; stop = undefined; release?.();
  };
  if (signal?.aborted) { dispose(); return { ready: Promise.resolve(), dispose }; }
  signal?.addEventListener('abort', dispose, { once: true });
  const ready = (async () => {
    try {
      const release = await open(target.device, raw => {
        if (!closed) sink.record({ ...raw, schemaVersion: 1, targetId: target.id, providerId: target.providerId, raw });
      }, reason => {
        if (closed) return;
        dispose();
        sink.end({ code: 'transport-ended', reason });
      });
      if (closed) release(); else stop = release;
    } catch (error) { dispose(); throw error; }
  })();
  return { ready, dispose };
}

/** All four adapters share existing ADB/usbmux/WebInspector ownership. */
export function createBuiltinProviders(open: OpenLogs, discover: () => Promise<DeviceList> = async () => ({ devices: [], warnings: [] })): LogProvider<BuiltinTarget>[] {
  return ['builtin.android.logcat', 'builtin.ios.syslog', 'builtin.android.webview', 'builtin.ios.webview'].map(id => ({
    apiVersion: PROVIDER_API_VERSION,
    id,
    async discover(signal) {
      signal?.throwIfAborted();
      const { devices } = await discover();
      signal?.throwIfAborted();
      return devices.flatMap(device => [providerTarget({ ...device, webview: undefined }),
        ...(device.webviews ?? []).map(webview => providerTarget({ ...device, webview }))]).filter(target => target.providerId === id);
    },
    open(target, sink, signal) {
      const expected = providerTarget(target.device);
      if (target.providerId !== id || expected.id !== target.id || expected.providerId !== id) {
        throw new Error('Target does not belong to provider');
      }
      return openSession(open, target, sink, signal);
    },
  }));
}

/** Temporary legacy HTTP/UI bridge: do not serialize duplicate raw payloads. */
export function openProviderLogs(providers: readonly LogProvider<BuiltinTarget>[]): OpenLogs {
  return async (device, message, end, signal) => {
    const target = providerTarget(device);
    const provider = providers.find(item => item.id === target.providerId);
    if (!provider || provider.apiVersion !== PROVIDER_API_VERSION) throw new Error('Unsupported log provider');
    const session = provider.open(target, { record: record => message(record.raw), end: event => end(event.reason) }, signal);
    await session.ready;
    return session.dispose;
  };
}

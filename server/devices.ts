import { createRequire } from 'node:module';
import type { DeviceWithPath } from '@devicefarmer/adbkit';
import logcat from '@devicefarmer/adbkit-logcat';
import { services, utilities } from 'appium-ios-device';
import { getDefaultSocket } from 'appium-ios-device/build/lib/usbmux/index.js';
import type { Socket } from 'node:net';
import type { Device, DeviceList, LogMessage } from '../shared/types.js';

import { notification, type Notification } from '../shared/notifications.js';

// Load CJS explicitly: Node 22 cannot infer Adb as an ESM named export,
// and adbkit's default-export typings differ from its runtime exports object.
const { Adb } = createRequire(import.meta.url)('@devicefarmer/adbkit') as typeof import('@devicefarmer/adbkit');
const adb = Adb.createClient({ bin: process.env.ADB_PATH || 'adb', timeout: 5000 });
export const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

async function androidDevices(): Promise<Device[]> {
  return (await adb.listDevicesWithPaths()).map((device: DeviceWithPath) => ({
    id: device.id,
    name: device.model?.replaceAll('_', ' ') || device.id,
    platform: 'android',
    state: device.type === 'device' || device.type === 'emulator' ? 'connected' : device.type,
  }));
}

async function iosDevices(): Promise<Device[]> {
  // Connect explicitly: getConnectedDevices otherwise hides a missing usbmuxd.
  const socket = await getDefaultSocket() as Socket;
  let ids: string[];
  try {
    ids = await utilities.getConnectedDevices(socket);
  } finally {
    socket.destroy();
  }
  return Promise.all(ids.map(async id => ({
    id,
    name: await utilities.getDeviceName(id).catch(() => id),
    platform: 'ios' as const,
    state: 'connected',
  })));
}

let pendingDiscovery: Promise<DeviceList> | undefined;
export function listDevices(): Promise<DeviceList> {
  // Coalesce simultaneous refreshes from multiple tabs.
  pendingDiscovery ??= Promise.allSettled([androidDevices(), iosDevices()]).then(results => {
    const devices: Device[] = [];
    const warnings: DeviceList['warnings'] = [];
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') devices.push(...result.value);
      else warnings.push(notification('discoveryUnavailable', { platform: index === 0 ? 'Android' : 'iOS', detail: errorText(result.reason) }));
    });
    return { devices, warnings };
  }).finally(() => { pendingDiscovery = undefined; });
  return pendingDiscovery;
}

export type Stop = () => void;
export type OpenLogs = (
  device: Device,
  onMessage: (message: LogMessage) => void,
  onEnd: (reason: Notification | string) => void,
) => Promise<Stop>;

export const openLogs: OpenLogs = async (device, onMessage, onEnd) => {
  if (device.platform === 'android') {
    // Own the socket for deterministic cleanup; openLogcat() returns a transformed
    // stream and hard-codes an info-level filter in the current adbkit release.
    const socket = await adb.getDevice(device.id).shell('logcat -B *:V');
    const reader = logcat.readStream(socket, { fixLineFeeds: false });
    reader.on('entry', entry => onMessage({
      timestamp: entry.date.toISOString(),
      message: entry.message,
      level: logcat.Priority.toLetter(entry.priority),
      tag: entry.tag,
      pid: entry.pid,
    }));
    reader.on('error', error => onEnd(notification('streamError', { platform: 'Android', detail: errorText(error) })));
    socket.on('close', () => onEnd(notification('streamEnded', { platform: 'Android' })));
    socket.on('end', () => onEnd(notification('streamEnded', { platform: 'Android' })));
    return () => { socket.destroy(); };
  }

  const service = await services.startSyslogService(device.id);
  // Appium's service has no public lifecycle events. Keep access to its socket
  // and decoder isolated here; package-lock pins the inspected implementation.
  service._socketClient.on('error', error => onEnd(notification('streamError', { platform: 'iOS', detail: errorText(error) })));
  service._socketClient.on('close', () => onEnd(notification('streamEnded', { platform: 'iOS' })));
  service._decoder.on('error', error => onEnd(notification('decodeError', { detail: errorText(error) })));
  service.start(message => onMessage({ timestamp: new Date().toISOString(), message }));
  return () => {
    service._socketClient.destroy();
    service._decoder.destroy();
  };
};

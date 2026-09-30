import type { Device } from '../shared/types';
import { readPreference, savePreference } from './preferences';

export const lastDeviceKey = 'uber-device-log.lastDevice';
export const deviceKey = (device: Device) => `${device.platform}:${device.id}`;

/** Restore only on initial successful discovery; polling must not start capture later. */
export function createRememberedDevice(read = readPreference, save = savePreference) {
  const saved = read(lastDeviceKey);
  let checked = false;
  return {
    restoreOnce(devices: Device[]): string {
      if (checked) return '';
      checked = true;
      return devices.find(device => device.state === 'connected' && deviceKey(device) === saved)
        ? saved! : '';
    },
    remember(device: Device | undefined) {
      // Disconnects and empty selections must preserve the last usable device.
      if (device?.state === 'connected') save(lastDeviceKey, deviceKey(device));
    },
  };
}

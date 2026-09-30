import type { Device, LogMessage } from './types';
import { formatLogMessages } from './log-view';

export type LogExportFormat = 'text' | 'json';

/** One export contains records from one device, in the requested display order. */
export interface LogExport {
  schemaVersion: 1;
  device: Pick<Device, 'id' | 'name' | 'platform'>;
  source: 'android-logcat' | 'ios-syslog';
  timestampSource: 'device' | 'host-receipt';
  entries: LogMessage[];
}

export function serializeLogExport(messages: readonly LogMessage[], device: Device, format: LogExportFormat) {
  if (format === 'text') {
    return { text: formatLogMessages(messages), mimeType: 'text/plain;charset=utf-8', extension: 'log' };
  }
  const document: LogExport = {
    schemaVersion: 1,
    device: { id: device.id, name: device.name, platform: device.platform },
    source: device.platform === 'android' ? 'android-logcat' : 'ios-syslog',
    timestampSource: device.platform === 'android' ? 'device' : 'host-receipt',
    // Explicit fields exclude UI selection keys and retain original message text.
    entries: messages.map(({ timestamp, message, level, tag, pid }) => ({ timestamp, message, level, tag, pid })),
  };
  return { text: JSON.stringify(document, null, 2), mimeType: 'application/json;charset=utf-8', extension: 'json' };
}

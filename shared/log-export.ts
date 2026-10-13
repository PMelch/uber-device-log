import type { Device, LogMessage, LogSourceMetadata, WebView } from './types';
import { formatLogMessages } from './log-view';

export type LogExportFormat = 'text' | 'json';

/** One export contains records from one device, in the requested display order. */
export interface LogExport {
  schemaVersion: 1;
  device: Pick<Device, 'id' | 'name' | 'platform'>;
  source: 'android-logcat' | 'ios-syslog' | 'android-webview';
  webview?: WebView;
  timestampSource: 'device' | 'host-receipt';
  entries: LogMessage[];
}

export interface InterleavedLogExport {
  schemaVersion: 2;
  device: Pick<Device, 'id' | 'name' | 'platform'>;
  sources: LogSourceMetadata[];
  entries: LogMessage[];
}

export function serializeLogExport(messages: readonly LogMessage[], device: Device, format: LogExportFormat) {
  if (format === 'text') {
    return { text: messages.map(entry => `${entry.source ? `[${entry.source.name}] ` : ''}${formatLogMessages([entry])}`).join('\n'), mimeType: 'text/plain;charset=utf-8', extension: 'log' };
  }
  if (messages.some(entry => entry.source)) {
    const document: InterleavedLogExport = {
      schemaVersion: 2,
      device: { id: device.id, name: device.name, platform: device.platform },
      sources: [...new Map(messages.flatMap(entry => entry.source ? [[entry.source.key, entry.source] as const] : [])).values()],
      entries: messages.map(({ timestamp, message, level, tag, pid, source }) => ({ timestamp, message, level, tag, pid, ...(source ? { source } : {}) })),
    };
    return { text: JSON.stringify(document, null, 2), mimeType: 'application/json;charset=utf-8', extension: 'json' };
  }
  const document: LogExport = {
    schemaVersion: 1,
    device: { id: device.id, name: device.name, platform: device.platform },
    source: device.webview ? 'android-webview' : device.platform === 'android' ? 'android-logcat' : 'ios-syslog',
    ...(device.webview ? { webview: device.webview } : {}),
    timestampSource: device.platform === 'android' ? 'device' : 'host-receipt',
    // Explicit fields exclude UI selection keys and retain original message text.
    entries: messages.map(({ timestamp, message, level, tag, pid }) => ({ timestamp, message, level, tag, pid })),
  };
  return { text: JSON.stringify(document, null, 2), mimeType: 'application/json;charset=utf-8', extension: 'json' };
}

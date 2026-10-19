import type { Notification } from './notifications';

export type Platform = 'android' | 'ios';

export interface WebView {
  id: string;
  socket: string;
  title: string;
  url: string;
  pid?: number;
}

export interface Device {
  id: string;
  platform: Platform;
  name: string;
  state: string;
  webviews?: WebView[];
  /** Selected capture target; absent for native device logs. */
  webview?: WebView;
}

export interface DeviceList {
  devices: Device[];
  warnings: (Notification | string)[];
}

export interface LogMessage {
  /** Capture adapter/server truncated the original message; analysis is incomplete. */
  truncated?: boolean;
  source?: LogSourceMetadata;
  timestamp: string;
  message: string;
  level?: string;
  tag?: string;
  pid?: number;
}

/** A selectable capture stream on a physical device. */
export interface LogSource {
  key: string;
  device: Device;
}

export interface LogSourceMetadata {
  key: string;
  name: string;
  platform: Platform;
  deviceId: string;
  webview?: WebView;
}

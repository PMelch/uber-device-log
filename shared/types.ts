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
  /** Host of the UDL process, independent of the browser's operating system. */
  setup?: DeviceSetup;
}

export interface DeviceSetup {
  host: 'windows' | 'linux' | 'macos' | 'other';
  issues: DeviceSetupIssue[];
}
export interface DeviceSetupIssue {
  platform: Platform;
  reason: 'adbMissing' | 'androidUnavailable' | 'iosUnavailable' | 'androidUnauthorized' | 'androidPermissions';
  /** Original diagnostic, rendered as plain text, never translated. */
  detail: string;
}

export interface LogMessage {
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

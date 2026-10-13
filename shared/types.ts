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
  timestamp: string;
  message: string;
  level?: string;
  tag?: string;
  pid?: number;
}

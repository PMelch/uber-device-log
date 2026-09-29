export type Platform = 'android' | 'ios';

export interface Device {
  id: string;
  platform: Platform;
  name: string;
  state: string;
}

export interface DeviceList {
  devices: Device[];
  warnings: string[];
}

export interface LogMessage {
  timestamp: string;
  message: string;
  level?: string;
  tag?: string;
  pid?: number;
}

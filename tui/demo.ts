import type { Device, LogMessage } from '../shared/types';

export const demoDevice: Device = { id: 'tui-demo', name: 'Demo Pixel', platform: 'android', state: 'connected' };
/** Deliberately fictional records; no device connection or filesystem changes. */
export function demoMessages(start: number, count: number): LogMessage[] {
  return Array.from({ length: count }, (_, index) => {
    const sequence = start + index;
    return {
      timestamp: new Date(Date.UTC(2026, 10, 3, 12) + sequence * 10).toISOString(),
      level: sequence % 23 === 0 ? 'ERROR' : sequence % 7 === 0 ? 'WARN' : 'INFO',
      tag: ['ActivityManager', 'DemoNetwork', 'WebView'][sequence % 3], pid: 4242,
      message: sequence % 23 === 0 ? `Request ${sequence} failed\njava.net.SocketTimeoutException: demo timeout\n    at demo.Client.fetch(Client.java:42)`
        : sequence % 7 === 0 ? `Slow frame ${sequence}: 42 ms · 日本語 · 中文 · Größe`
          : `Demo event ${sequence}: ${JSON.stringify({ requestId: `demo-${sequence}`, result: 'ok', elapsedMs: sequence % 90 })}`,
      source: { key: 'demo', name: demoDevice.name, platform: 'android', deviceId: demoDevice.id },
    };
  });
}

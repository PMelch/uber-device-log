export const bufferSizes = [1000, 2000, 10000, 50000, 100000] as const;
export const themes = ['system', 'light', 'dark'] as const;
export type Theme = typeof themes[number];
export type MessageOrder = 'top' | 'bottom';
export function resolveMessageOrder(value: string | null): MessageOrder { return value === 'bottom' ? 'bottom' : 'top'; }
export const preferenceKeys = { order: 'uber-device-log.messageOrder', theme: 'uber-device-log.theme', bufferSize: 'uber-device-log.bufferSize' };
export function resolveTheme(value: string | null): Theme {
  return themes.includes(value as Theme) ? value as Theme : 'system';
}
export function resolveBufferSize(value: string | null): number {
  const size = Number(value);
  return bufferSizes.some(option => option === size) ? size : 2000;
}
export function readPreference(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
export function savePreference(key: string, value: string) {
  try { window.localStorage.setItem(key, value); } catch { /* Session settings still work. */ }
}

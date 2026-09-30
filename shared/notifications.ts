/** Stable codes keep server events translatable without reconnecting a stream. */
export const notificationMessages = {
  discoveryUnavailable: '{platform} discovery unavailable: {detail}',
  streamError: '{platform} log error: {detail}',
  streamEnded: '{platform} device disconnected or log stream ended. Reconnect to resume.',
  decodeError: 'iOS log decode error: {detail}',
  streamTimeout: 'Connection timed out. Check device authorization and reconnect.',
  streamSkipped: 'Live — skipped messages: {count}. The viewer is catching up.',
  streamLive: 'Live — reading device logs.',
  streamCannotRead: 'Cannot read logs: {detail}. Check device trust/debugging and reconnect.',
} as const;

export type NotificationCode = keyof typeof notificationMessages;
export type MessageParams = Record<string, string | number>;
export interface Notification {
  code: NotificationCode;
  params: MessageParams;
  /** English fallback for clients that do not understand the code. */
  message: string;
}
export function notification(code: NotificationCode, params: MessageParams = {}): Notification {
  return { code, params, message: interpolate(notificationMessages[code], params) };
}
export function interpolate(template: string, params: MessageParams): string {
  return template.replace(/\{(\w+)\}/g, (token, key: string) => Object.hasOwn(params, key) ? String(params[key]) : token);
}

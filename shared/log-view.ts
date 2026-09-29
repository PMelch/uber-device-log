import type { LogMessage, Platform } from './types';
export const logLevels = ['VERBOSE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'] as const;
export type LogLevel = typeof logLevels[number];
export function logLevel(level?: string): string {
  const aliases: Record<string, string> = { V: 'VERBOSE', D: 'DEBUG', I: 'INFO', W: 'WARN', E: 'ERROR', F: 'FATAL', A: 'FATAL' };
  return aliases[level ?? ''] ?? level ?? '';
}
export function filterLogLevels<T extends LogMessage>(messages: T[], platform: Platform | undefined, levels: readonly LogLevel[]): T[] {
  if (platform !== 'android' || logLevels.every(level => levels.includes(level))) return messages;
  return messages.filter(message => levels.includes(logLevel(message.level) as LogLevel));
}
export function formatLogMessages(messages: readonly LogMessage[]): string {
  return messages.map(entry => {
    const tag = `${entry.tag ?? ''}${entry.pid !== undefined ? `[${entry.pid}]` : ''}`;
    const metadata = [entry.level, tag].filter(Boolean).join(' ');
    return `${entry.timestamp} ${metadata ? `${metadata}: ` : ''}${entry.message}`;
  }).join('\n');
}

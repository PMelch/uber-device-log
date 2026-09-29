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

/** Preserve a native text selection exactly; otherwise export the displayed records. */
export function logExportText(messages: readonly LogMessage[], selection: string): string {
  return selection || formatLogMessages(messages);
}

export interface LogStackLine {
  kind: 'message' | 'exception' | 'frame' | 'cause' | 'omitted';
  text: string;
  location?: string;
}

/** Presentation only: never change the stored message used for search/export. */
export function parseLogStack(message: string): LogStackLine[] | undefined {
  // Most records are not traces. Avoid splitting/allocating lines for those records.
  if (!/(?:^|\n)(?:[\t ]|&#(?:x0*9|0*9);)*at\s+\S+\([^\r\n]*\)/i.test(message)) return;
  let hasFrame = false;
  const lines = message.split(/\r?\n/).map((raw): LogStackLine => {
    // Decode only tab entities in indentation, never arbitrary HTML in log text.
    const text = raw.replace(/^(?:[\t ]|&#(?:x0*9|0*9);)+/i, indent => indent.replace(/&#(?:x0*9|0*9);/gi, '\t'));
    const frame = /^(\s*at\s+\S+)(\([^()\r\n]*\)\s*)$/.exec(text);
    if (frame) {
      hasFrame = true;
      return { kind: 'frame', text: frame[1]!, location: frame[2]! };
    }
    if (/^\s*(?:Caused by:|Suppressed:)/.test(text)) return { kind: 'cause', text };
    if (/^\s*\.\.\.\s+\d+\s+more\s*$/.test(text)) return { kind: 'omitted', text };
    if (/^\s*(?:[\w$]+\.)*[\w$]*(?:Exception|Error)(?::|$)/.test(text)) return { kind: 'exception', text };
    return { kind: 'message', text };
  });
  return hasFrame ? lines : undefined;
}

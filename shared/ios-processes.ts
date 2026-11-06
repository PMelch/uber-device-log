import type { LogMessage, AndroidProcess } from './types';
import { isLogPidFilterValid } from './log-view';

/** Known anchored envelopes only. Never consume/modify the original message. */
export function parseIosProcess(message: string): Pick<LogMessage, 'processName' | 'pid'> | undefined {
  const legacy = /^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[ \t]+(?:[1-9]|[12]\d|3[01])[ \t]+(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d[ \t]+(?:[^\s[\]]+[ \t]+)?([^\s([\]]+)(?:\([^\r\n()]+\))?\[(\d+)\][ \t]+<[A-Za-z]+>:[ \t]?/;
  const dated = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])[ T](?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?[ \t]+([^\s([\]]+)\[(\d+):\d+\][ \t]+/;
  const match = legacy.exec(message) ?? dated.exec(message);
  if (!match || !Number.isSafeInteger(Number(match[2]))) return;
  return { processName: match[1]!, pid: Number(match[2]) };
}

/** Latest retained observation per name, not a running-process inventory. */
export function observedIosProcesses(messages: readonly LogMessage[], sourceKey: string, limit = 1000): AndroidProcess[] {
  const processes = new Map<string, AndroidProcess>();
  for (let i = messages.length - 1; i >= 0 && processes.size < limit; i--) {
    const entry = messages[i]!;
    if (entry.source?.key !== sourceKey || entry.source.platform !== 'ios' || entry.source.webview || !entry.processName || entry.pid === undefined) continue;
    if (!processes.has(entry.processName)) processes.set(entry.processName, { name: entry.processName, pid: entry.pid });
  }
  return [...processes.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function filterIosProcesses<T extends LogMessage>(messages: T[], name = '', pid = ''): T[] {
  if (!isLogPidFilterValid(pid)) return [];
  return messages.filter(entry => (!name || entry.processName === name) && (!pid.trim() || entry.pid === Number(pid)));
}

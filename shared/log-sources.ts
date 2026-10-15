import type { LogMessage } from './types';
import { createLogSearch, type LogSearchMode } from './search';
import { filterLogLevels, filterLogMetadata, logLevels, type LogLevel } from './log-view';

export interface SourceFilter {
  text: string;
  mode: LogSearchMode;
  tag: string;
  pid: string;
  levels: LogLevel[];
}

export function defaultSourceFilter(): SourceFilter {
  return { text: '', mode: 'fuzzy', tag: '', pid: '', levels: [...logLevels] };
}

/** Apply each source's filters independently, retaining the original display order. */
export function filterSourceMessages<T extends LogMessage>(messages: T[], filters: Record<string, SourceFilter>): T[] {
  const groups = new Map<string, T[]>();
  for (const message of messages) {
    if (!message.source || !filters[message.source.key]) continue;
    const group = groups.get(message.source.key) ?? [];
    group.push(message);
    groups.set(message.source.key, group);
  }
  const matched = new Set<T>();
  for (const [key, group] of groups) {
    const filter = filters[key]!;
    const platform = group[0]!.source!.webview ? 'android' : group[0]!.source!.platform;
    const metadata = filterLogMetadata(group, platform, filter.tag, filter.pid);
    const levels = filterLogLevels(metadata, platform, filter.levels);
    const found = filter.text.trim() ? createLogSearch(levels)(filter.text, filter.mode) : levels;
    for (const message of found) matched.add(message);
  }
  return messages.filter(message => !message.source || !filters[message.source.key] || matched.has(message));
}

/**
 * Cache matches by immutable record identity and source filter signature.
 * Reuse this function's result across batches; replacing filters invalidates only
 * changed signatures. Records without a matching filter pass through unchanged.
 */
export function createSourceFilterer() {
  const caches = new Map<string, { signature: string; matches: WeakMap<LogMessage, boolean> }>();
  return <T extends LogMessage>(messages: T[], filters: Record<string, SourceFilter>): T[] => {
    for (const key of caches.keys()) if (!filters[key]) caches.delete(key);
    for (const [key, filter] of Object.entries(filters)) {
      const signature = JSON.stringify([filter.text, filter.mode, filter.tag, filter.pid, filter.levels]);
      if (caches.get(key)?.signature !== signature) caches.set(key, { signature, matches: new WeakMap() });
    }
    const pending = new Map<string, T[]>();
    for (const message of messages) {
      const key = message.source?.key;
      if (!key || !filters[key]) continue;
      const cache = caches.get(key)!;
      if (!cache.matches.has(message)) {
        const group = pending.get(key) ?? [];
        group.push(message);
        pending.set(key, group);
      }
    }
    for (const [key, group] of pending) {
      const filter = filters[key]!;
      const platform = group[0]!.source!.webview ? 'android' : group[0]!.source!.platform;
      const candidates = filterLogLevels(filterLogMetadata(group, platform, filter.tag, filter.pid), platform, filter.levels);
      const found = new Set(filter.text.trim() ? createLogSearch(candidates)(filter.text, filter.mode) : candidates);
      const cache = caches.get(key)!;
      for (const message of group) cache.matches.set(message, found.has(message));
    }
    return messages.filter(message => !message.source || !filters[message.source.key]
      || caches.get(message.source.key)!.matches.get(message));
  };
}

const timestamps = new WeakMap<LogMessage, number>();
function logTimestamp(message: LogMessage): number {
  let timestamp = timestamps.get(message);
  if (timestamp === undefined) {
    const parsed = Date.parse(message.timestamp);
    // Unknown timestamps precede dated logs; arrival keys provide deterministic ties.
    timestamp = Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
    timestamps.set(message, timestamp);
  }
  return timestamp;
}
function compareMessages<T extends LogMessage & { key: number }>(left: T, right: T): number {
  const a = logTimestamp(left), b = logTimestamp(right);
  return (a === b ? 0 : a < b ? -1 : 1) || left.key - right.key;
}

/**
 * Merge immutable records into ascending timestamp/key order, retaining capacity.
 * Existing records must already be sorted; incoming records may arrive out of order.
 * Invalid timestamps precede valid ones and unique UI keys break ties. The newest
 * timestamps survive retention, which need not be the most recently received logs.
 */
export function mergeSourceMessages<T extends LogMessage & { key: number }>(existing: T[], incoming: T[], capacity: number): T[] {
  if (capacity <= 0) return [];
  if (!incoming.length) return existing.length <= capacity ? existing : existing.slice(-capacity);
  const batch = [...incoming].sort(compareMessages);
  if (!existing.length) return batch.slice(-capacity);
  if (compareMessages(existing[existing.length - 1]!, batch[0]!) <= 0) {
    if (batch.length >= capacity) return batch.slice(-capacity);
    return existing.slice(Math.max(0, existing.length - (capacity - batch.length))).concat(batch);
  }
  const result = new Array<T>(Math.min(capacity, existing.length + batch.length));
  let left = existing.length - 1, right = batch.length - 1;
  for (let index = result.length - 1; index >= 0; index--) {
    result[index] = right < 0 || (left >= 0 && compareMessages(existing[left]!, batch[right]!) > 0)
      ? existing[left--]! : batch[right--]!;
  }
  return result;
}

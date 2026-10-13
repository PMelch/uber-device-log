import Fuse from 'fuse.js';
import type { LogMessage } from './types';

export type LogSearchMode = 'fuzzy' | 'literal';

const fields = new WeakMap<LogMessage, string[]>();
function searchFields(message: LogMessage): string[] {
  let cached = fields.get(message);
  if (!cached) {
    cached = [message.timestamp, message.level, message.tag, message.pid, message.message]
      .filter(value => value !== undefined).map(String);
    fields.set(message, cached);
  }
  return cached;
}

export function createLogSearch<T extends LogMessage>(messages: T[]) {
  // Log records are immutable; WeakMap entries disappear with trimmed records.
  let index: Fuse<{ message: T; text: string }> | undefined;
  const fuzzyIndex = () => index ??= new Fuse(messages.map(message => ({
    message,
    text: searchFields(message).join(' '),
  })), {
    keys: ['text'], threshold: 0.3, ignoreLocation: true,
    ignoreFieldNorm: true, shouldSort: false,
  });

  return (query: string, mode: LogSearchMode = 'fuzzy'): T[] => {
    if (mode === 'literal') {
      const text = query.trim().toLowerCase();
      if (!text) return messages;
      return messages.filter(message => searchFields(message).some(value => value.toLowerCase().includes(text)));
    }
    const terms = query.trim().split(/\s+/).filter(Boolean);
    if (!terms.length) return messages;
    // Require every term, anywhere in the record, without changing log order.
    return fuzzyIndex().search({ $and: terms.map(text => ({ text })) }).map(result => result.item.message);
  };
}

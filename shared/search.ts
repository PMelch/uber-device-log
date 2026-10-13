import Fuse from 'fuse.js';
import type { LogMessage } from './types';

export type LogSearchMode = 'fuzzy' | 'literal';

export function createLogSearch<T extends LogMessage>(messages: T[]) {
  const index = new Fuse(messages.map(message => ({
    message,
    text: [message.timestamp, message.level, message.tag, message.pid, message.message]
      .filter(value => value !== undefined).join(' '),
  })), {
    keys: ['text'],
    threshold: 0.3,
    ignoreLocation: true,
    ignoreFieldNorm: true,
    shouldSort: false,
  });

  return (query: string, mode: LogSearchMode = 'fuzzy'): T[] => {
    if (mode === 'literal') {
      const text = query.trim().toLowerCase();
      if (!text) return messages;
      return messages.filter(message => [message.timestamp, message.level, message.tag, message.pid, message.message]
        .some(value => value !== undefined && String(value).toLowerCase().includes(text)));
    }
    const terms = query.trim().split(/\s+/).filter(Boolean);
    if (!terms.length) return messages;
    // Require every term, anywhere in the record, without changing log order.
    return index.search({ $and: terms.map(text => ({ text })) }).map(result => result.item.message);
  };
}

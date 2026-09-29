import Fuse from 'fuse.js';
import type { LogMessage } from './types';

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

  return (query: string): T[] => {
    const terms = query.trim().split(/\s+/).filter(Boolean);
    if (!terms.length) return messages;
    // Require every term, anywhere in the record, without changing log order.
    return index.search({ $and: terms.map(text => ({ text })) }).map(result => result.item.message);
  };
}

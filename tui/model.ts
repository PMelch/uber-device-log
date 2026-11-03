import type { LogMessage } from '../shared/types';
import { mergeSourceMessages } from '../shared/log-sources';
import { createLogSearch } from '../shared/search';

export type TuiLog = LogMessage & { key: number };

/** Only presentation is escaped. Captured records and exports remain verbatim. */
export function terminalText(value: string): string {
  return value.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, ch => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

export function createLogModel(capacity = 2000) {
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100000) throw new Error('Capacity must be 1–100000.');
  let live: TuiLog[] = [];
  let snapshot: TuiLog[] | undefined;
  let nextKey = 0;
  let query = '';
  let selectedKey: number | undefined;
  let cachedInput: TuiLog[] | undefined;
  let cachedQuery = '';
  let filtered: TuiLog[] = [];
  function rows() {
    const input = snapshot ?? live;
    if (input !== cachedInput || query !== cachedQuery) {
      filtered = createLogSearch(input)(query, 'literal');
      cachedInput = input; cachedQuery = query;
    }
    return filtered;
  }
  return {
    get paused() { return snapshot !== undefined; },
    get liveCount() { return live.length; },
    get query() { return query; },
    get selected() { return selectedKey === undefined ? undefined : rows().find(row => row.key === selectedKey); },
    rows,
    ingest(messages: LogMessage[]) {
      live = mergeSourceMessages(live, messages.map(message => ({ ...message, key: nextKey++ })), capacity);
    },
    pause() { snapshot ??= live; },
    resume() { snapshot = undefined; selectedKey = undefined; },
    clear() { live = []; if (snapshot) snapshot = []; selectedKey = undefined; },
    select(key: number) {
      if (!rows().some(row => row.key === key)) return;
      snapshot ??= live; selectedKey = key;
    },
    setQuery(value: string) {
      query = value;
      if (selectedKey !== undefined && !rows().some(row => row.key === selectedKey)) selectedKey = undefined;
    },
  };
}

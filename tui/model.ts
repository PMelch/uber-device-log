import type { MessageOrder } from '../src/preferences';
import type { LogMessage } from '../shared/types';
import { mergeSourceMessages } from '../shared/log-sources';
import { createLogSearch, type LogSearchMode } from '../shared/search';

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
  let searchMode: LogSearchMode = 'literal';
  let cachedMode: LogSearchMode | undefined;
  let order: MessageOrder = 'bottom';
  let cachedOrder: MessageOrder | undefined;
  let selectedKey: number | undefined;
  let cachedInput: TuiLog[] | undefined;
  let cachedQuery = '';
  let filtered: TuiLog[] = [];
  let search: ReturnType<typeof createLogSearch<TuiLog>> | undefined;
  function rows() {
    const input = snapshot ?? live;
    if (input !== cachedInput || query !== cachedQuery || order !== cachedOrder || searchMode !== cachedMode) {
      if (input !== cachedInput || !search) search = createLogSearch(input);
      filtered = search(query, searchMode);
      if (order === 'top') filtered = [...filtered].reverse();
      cachedInput = input; cachedQuery = query; cachedOrder = order; cachedMode = searchMode;
    }
    return filtered;
  }
  return {
    get capacity() { return capacity; },
    get order() { return order; },
    setOrder(value: MessageOrder) { order = value; },
    setCapacity(value: number) {
      if (!Number.isInteger(value) || value < 1 || value > 100000) throw new Error('Capacity must be 1–100000.');
      capacity = value; live = live.slice(-capacity);
      if (snapshot) snapshot = snapshot.slice(-capacity);
      if (selectedKey !== undefined && !rows().some(row => row.key === selectedKey)) selectedKey = undefined;
    },
    get paused() { return snapshot !== undefined; },
    get liveCount() { return live.length; },
    get query() { return query; },
    get searchMode() { return searchMode; },
    setSearchMode(value: LogSearchMode) {
      searchMode = value;
      if (selectedKey !== undefined && !rows().some(row => row.key === selectedKey)) selectedKey = undefined;
    },
    get selected() { return selectedKey === undefined ? undefined : rows().find(row => row.key === selectedKey); },
    rows,
    ingest(messages: LogMessage[]) {
      live = mergeSourceMessages(live, messages.map(message => ({ ...message, key: nextKey++ })), capacity);
    },
    pause() { snapshot ??= live; },
    resume() { snapshot = undefined; selectedKey = undefined; },
    removeSource(key: string) {
      live = live.filter(row => row.source?.key !== key);
      if (snapshot) snapshot = snapshot.filter(row => row.source?.key !== key);
      if (selectedKey !== undefined && !rows().some(row => row.key === selectedKey)) selectedKey = undefined;
    },
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

import { test } from 'node:test';
import assert from 'node:assert/strict';

async function model(capacity = 2000) {
  const api = await import('./model.ts').catch(() => ({})) as Record<string, any>;
  assert.equal(typeof api.createLogModel, 'function', 'TUI log model must exist');
  return api.createLogModel(capacity);
}
const record = (message: string) => ({ timestamp: '2026-11-03T12:00:00.000Z', message, level: 'INFO' });

test('pause retains the displayed snapshot while capture continues and evicts live data', async () => {
  const state = await model(2);
  state.ingest([record('first'), record('second')]);
  state.pause();
  state.ingest([record('third'), record('fourth')]);
  assert.deepEqual(state.rows().map((r: any) => r.message), ['first', 'second']);
  assert.equal(state.liveCount, 2);
  state.resume();
  assert.deepEqual(state.rows().map((r: any) => r.message), ['third', 'fourth']);
});

test('selecting a record freezes the view; clear removes both snapshot and live entries', async () => {
  const state = await model();
  state.ingest([record('first')]);
  state.select(state.rows()[0].key);
  state.ingest([record('second')]);
  assert.equal(state.paused, true);
  assert.equal(state.rows().length, 1);
  assert.equal(state.selected.message, 'first');
  state.clear();
  assert.equal(state.rows().length, 0);
  assert.equal(state.liveCount, 0);
  assert.equal(state.selected, undefined);
  state.ingest([record('third')]);
  state.resume();
  assert.deepEqual(state.rows().map((r: any) => r.message), ['third']);
});

test('literal search handles punctuation and removes a hidden selection', async () => {
  const state = await model();
  state.ingest([record('a [b]'), record('other')]);
  state.select(state.rows()[1].key);
  state.setQuery('[b]');
  assert.deepEqual(state.rows().map((r: any) => r.message), ['a [b]']);
  assert.equal(state.selected, undefined);
});

test('display escapes terminal controls without mutating original logs', async () => {
  const api = await import('./model.ts').catch(() => ({})) as Record<string, any>;
  assert.equal(typeof api.terminalText, 'function', 'Terminal-safe text formatter must exist');
  const original = 'hello\x1b[2J\x07\rworld\n日本語';
  assert.equal(api.terminalText(original).includes('\x1b'), false);
  assert.equal(api.terminalText(original).includes('\x07'), false);
  assert.equal(api.terminalText(original).includes('\r'), false);
  assert.ok(api.terminalText(original).includes('\n日本語'));
  assert.equal(original, 'hello\x1b[2J\x07\rworld\n日本語');
});

test('settings trim live and frozen buffers and reorder without losing retained selection', async () => {
  const state = await model(4);
  state.ingest([record('a'), record('b'), record('c'), record('d')]);
  state.select(state.rows()[3].key);
  state.setOrder('top');
  assert.deepEqual(state.rows().map((r: any) => r.message), ['d', 'c', 'b', 'a']);
  assert.equal(state.selected.message, 'd');
  state.ingest([record('e')]);
  state.setCapacity(2);
  assert.equal(state.capacity, 2);
  assert.deepEqual(state.rows().map((r: any) => r.message), ['d', 'c']);
  assert.equal(state.paused, true);
  state.resume();
  assert.deepEqual(state.rows().map((r: any) => r.message), ['e', 'd']);
  assert.throws(() => state.setCapacity(0));
  assert.equal(state.capacity, 2);
});

test('search mode switches literal and fuzzy without changing capture or the frozen snapshot', async () => {
  const state = await model();
  state.ingest([record('Payment authorized'), record('unrelated')]);
  state.setQuery('Paymnt');
  assert.equal(state.rows().length, 0);
  state.setSearchMode('fuzzy');
  assert.equal(state.rows()[0].message, 'Payment authorized');
  state.select(state.rows()[0].key);
  state.ingest([record('Payment pending')]);
  state.setSearchMode('literal');
  assert.equal(state.selected, undefined);
  assert.equal(state.rows().length, 0);
  assert.equal(state.paused, true);
  state.setSearchMode('fuzzy');
  assert.equal(state.rows().length, 1);
  state.resume();
  assert.equal(state.rows().length, 2);
});

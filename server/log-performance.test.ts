import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as sources from '../shared/log-sources';
import { createLogSearch } from '../shared/search';

const source = { key: 'phone', name: 'Phone', platform: 'android' as const, deviceId: 'phone' };
function row(key: number) { return { key, timestamp: new Date(key * 1000).toISOString(), message: `record ${key}`, source }; }

test('live merge parses each immutable timestamp only once across updates', () => {
  let reads = 0;
  const records = Array.from({ length: 100 }, (_, key) => {
    const record = row(key);
    return { ...record, get timestamp() { reads++; return record.timestamp; } };
  });
  let retained: typeof records = [];
  for (const record of records) retained = sources.mergeSourceMessages(retained, [record], 100);
  assert.equal(retained.length, 100);
  assert.ok(reads <= 100, `timestamp read ${reads} times for 100 records`);
});

test('literal search does not build or read a fuzzy index before a query', () => {
  let reads = 0;
  const record = { timestamp: 'now', get message() { reads++; return 'Connection failed'; } };
  const search = createLogSearch([record]);
  assert.equal(reads, 0);
  assert.deepEqual(search('connection', 'literal'), [record]);
});

test('source filtering reuses matches for retained rows and invalidates on filter changes', () => {
  const create = (sources as unknown as { createSourceFilterer?: () => typeof sources.filterSourceMessages }).createSourceFilterer;
  assert.equal(typeof create, 'function', 'incremental source filter is missing');
  const filter = create!();
  let reads = 0;
  const first = { ...row(1), get message() { reads++; return 'Connection failed'; } };
  const filters = { phone: { ...sources.defaultSourceFilter(), text: 'connection', mode: 'literal' as const } };
  assert.deepEqual(filter([first], filters), [first]);
  reads = 0;
  const second = row(2);
  assert.deepEqual(filter([first, second], filters), [first]);
  assert.equal(reads, 0);
  assert.deepEqual(filter([first, second], { phone: { ...filters.phone, text: 'record' } }), [second]);
});

test('batch merge agrees with chronological sort for delayed deliveries and capacity rollover', () => {
  let retained: ReturnType<typeof row>[] = [];
  let reference: typeof retained = [];
  for (let batch = 0; batch < 50; batch++) {
    const incoming = Array.from({ length: 13 }, (_, index) => row((batch * 13 + index) ^ 7));
    reference = [...reference, ...incoming].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp) || a.key - b.key).slice(-100);
    retained = sources.mergeSourceMessages(retained, incoming, 100);
    assert.deepEqual(retained, reference);
  }
});

test('invalid timestamps have a deterministic order and oversized batches retain newest rows', () => {
  const invalid = { ...row(2), timestamp: 'unknown' };
  const alsoInvalid = { ...row(1), timestamp: '' };
  assert.deepEqual(sources.mergeSourceMessages([], [row(3), invalid, alsoInvalid], 10), [alsoInvalid, invalid, row(3)]);
  assert.deepEqual(sources.mergeSourceMessages([alsoInvalid, invalid, row(3)], [row(4)], 2), [row(3), row(4)]);
  const incoming = Array.from({ length: 1000 }, (_, index) => row(index + 10)).reverse();
  assert.deepEqual(sources.mergeSourceMessages([row(3)], incoming, 10).map(entry => entry.key), Array.from({ length: 10 }, (_, index) => index + 1000));
});

test('incremental fuzzy filtering equals a full search across source, mode and metadata changes', () => {
  const filter = sources.createSourceFilterer();
  const records = Array.from({ length: 120 }, (_, index) => ({ ...row(index),
    message: index % 3 ? 'Connection established' : 'Frame rendered', tag: index % 2 ? 'Network' : 'App', pid: index % 4,
    level: index % 5 ? 'I' : 'E',
  }));
  const filters = { phone: { ...sources.defaultSourceFilter(), text: 'conection' } };
  for (let count = 10; count <= records.length; count += 10) {
    const retained = records.slice(Math.max(0, count - 40), count);
    assert.deepEqual(filter(retained, filters), sources.filterSourceMessages(retained, filters));
  }
  for (const patch of [{ mode: 'literal' as const }, { text: 'connection', mode: 'literal' as const }, { tag: 'Network' }, { pid: '1' }, { levels: ['ERROR'] as const }, { text: '' }]) {
    const current = { phone: { ...filters.phone, ...patch, levels: [...(patch.levels ?? filters.phone.levels)] } };
    assert.deepEqual(filter(records, current), sources.filterSourceMessages(records, current));
  }
});

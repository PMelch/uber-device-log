import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultSourceFilter, filterSourceMessages, mergeSourceMessages } from '../shared/log-sources';

const phone = { key: 'phone', name: 'Pixel', platform: 'android' as const, deviceId: 'device' };
const web = { ...phone, key: 'web', name: 'Slot', webview: { id: '1', socket: 'socket', title: 'Slot', url: 'https://example.org' } };
const rows = [
  { key: 1, timestamp: '2026-10-13T10:00:01Z', message: 'native warning', level: 'W', tag: 'App', pid: 42, source: phone },
  { key: 2, timestamp: '2026-10-13T10:00:02Z', message: 'web error', level: 'E', tag: 'console', pid: 43, source: web },
  { key: 3, timestamp: '2026-10-13T10:00:03Z', message: 'web warning', level: 'W', tag: 'console', pid: 43, source: web },
];
test('source filters independently combine text, levels and metadata without losing chronological order', () => {
  assert.deepEqual(filterSourceMessages(rows, {
    phone: { ...defaultSourceFilter(), text: 'native', mode: 'literal', tag: 'App', pid: '42', levels: ['WARN'] },
    web: { ...defaultSourceFilter(), text: 'web', mode: 'literal', levels: ['ERROR'] },
  }), rows.slice(0, 2));
  assert.deepEqual(filterSourceMessages(rows, { web: { ...defaultSourceFilter(), pid: 'invalid' } }), [rows[0]]);
});
test('missing source metadata or filter keeps legacy records and defaults do not share mutable levels', () => {
  const legacy = { timestamp: 'time', message: 'legacy' };
  assert.deepEqual(filterSourceMessages([legacy, ...rows], {}), [legacy, ...rows]);
  const first = defaultSourceFilter(); first.levels.length = 0;
  assert.equal(defaultSourceFilter().levels.length, 6);
});
test('merge sorts delayed deliveries by time, keys break ties, capacity retains newest and origins survive', () => {
  const delayed = { ...rows[1]!, key: 4, timestamp: rows[0]!.timestamp };
  assert.deepEqual(mergeSourceMessages([rows[2]!], [rows[0]!, delayed, rows[1]!], 3), [delayed, rows[1], rows[2]]);
  assert.deepEqual(mergeSourceMessages(rows, [], 0), []);
  assert.deepEqual(rows.map(row => row.key), [1, 2, 3]);
});

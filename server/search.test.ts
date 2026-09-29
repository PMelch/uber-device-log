import assert from 'node:assert/strict';
import test from 'node:test';
import { createLogSearch } from '../shared/search';

const entries = [
  { timestamp: '2026-09-29T10:00:00Z', message: 'Connection failed', tag: 'Network', level: 'E', pid: 1234 },
  { timestamp: '2026-09-29T10:00:01Z', message: 'Frame rendered successfully', tag: 'Unity', level: 'I', pid: 5678 },
  { timestamp: '2026-09-29T10:00:02Z', message: `${'Verbose stack trace context '.repeat(100)}connection timeout`, tag: 'Network' },
];
const search = createLogSearch(entries);

test('filter matches case-insensitively and tolerates typos without reordering', () => {
  assert.deepEqual(search('CONECTION'), [entries[0], entries[2]]);
});
test('all terms must match, including metadata and terms late in long messages', () => {
  assert.deepEqual(search('timeout network'), [entries[2]]);
  assert.deepEqual(search('unity 5678 rendered'), [entries[1]]);
  assert.deepEqual(search('2026-09-29T10:00:01Z successfully'), [entries[1]]);
  assert.deepEqual(search('network rendered'), []);
});
test('empty filter restores all records and unmatched text returns none', () => {
  assert.deepEqual(search('  \n '), entries);
  assert.deepEqual(search('zzzzzzzzzz'), []);
  assert.deepEqual(entries[0]?.message, 'Connection failed');
});

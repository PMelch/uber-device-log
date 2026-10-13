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

test('literal mode matches a contiguous query without typo tolerance or cross-field joins', () => {
  assert.deepEqual(search('CONECTION', 'literal'), []);
  assert.deepEqual(search('CONNECTION FAILED', 'literal'), [entries[0]]);
  assert.deepEqual(search('  connection failed  ', 'literal'), [entries[0]]);
  assert.deepEqual(search('network rendered', 'literal'), []);
  assert.deepEqual(search('1234 Connection', 'literal'), []);
  assert.deepEqual(search('5678', 'literal'), [entries[1]]);
  assert.deepEqual(search('2026-09-29T10:00:01Z', 'literal'), [entries[1]]);
  assert.deepEqual(search('connection timeout', 'literal'), [entries[2]]);
  assert.deepEqual(search('  ', 'literal'), entries);
});

test('literal mode treats regex characters and multiline content as original text', () => {
  const record = { timestamp: 'now', message: 'failed [a.*]\n  at file.ts:42' };
  const literal = createLogSearch([record]);
  assert.deepEqual(literal('[a.*]', 'literal'), [record]);
  assert.deepEqual(literal('failed [a.*]\n  at', 'literal'), [record]);
  assert.deepEqual(literal('failed.*at', 'literal'), []);
  assert.equal(record.message, 'failed [a.*]\n  at file.ts:42');
});

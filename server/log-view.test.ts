import assert from 'node:assert/strict';
import test from 'node:test';
import { filterLogLevels, formatLogMessages, logLevel } from '../shared/log-view';
import { createLogSearch } from '../shared/search';
const entries = [
  { timestamp: 't1', level: 'I', tag: 'Unity', pid: 0, message: 'hello' },
  { timestamp: 't2', level: 'E', tag: 'Unity', pid: 12, message: 'failed\n  stack' },
  { timestamp: 't3', message: 'original iOS text' },
];
test('Android levels normalize letters and combine with search without mutating records', () => {
  assert.equal(logLevel('F'), 'FATAL');
  assert.equal(logLevel('W'), 'WARN');
  assert.deepEqual(filterLogLevels(createLogSearch(entries)('Unity'), 'android', ['ERROR']), [entries[1]]);
  assert.deepEqual(filterLogLevels(entries, 'android', []), []);
  assert.equal(entries.length, 3);
});
test('iOS bypasses Android selection and all levels retain unknown records', () => {
  assert.deepEqual(filterLogLevels(entries, 'ios', []), entries);
  assert.deepEqual(filterLogLevels(entries, 'android', ['VERBOSE','DEBUG','INFO','WARN','ERROR','FATAL']), entries);
});
test('export preserves displayed order, zero PID, multiline text and iOS originals', () => {
  assert.equal(formatLogMessages([entries[1]!, entries[0]!]), 't2 E Unity[12]: failed\n  stack\nt1 I Unity[0]: hello');
  assert.equal(formatLogMessages([entries[2]!]), 't3 original iOS text');
  assert.equal(formatLogMessages([]), '');
});

test('selection export preserves the exact range and falls back to the full displayed log', async () => {
  const { logExportText } = await import('../shared/log-view');
  assert.equal(logExportText(entries, 'failed\n  sta'), 'failed\n  sta');
  assert.equal(logExportText(entries, ''), formatLogMessages(entries));
  assert.equal(logExportText([], ''), '');
});

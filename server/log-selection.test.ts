import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rangeKeys, selectedEntries } from '../shared/log-selection';

test('ranges follow display order in both directions, including endpoints', () => {
  const rows = [{key:9},{key:5},{key:2},{key:0}];
  assert.deepEqual([...rangeKeys(rows,2,9)], [9,5,2]);
  assert.deepEqual([...rangeKeys(rows,9,2)], [9,5,2]);
  assert.deepEqual([...rangeKeys(rows,99,2)], []);
});
test('exports only visible selected records, in display order, preserving multiline messages', () => {
  const rows = [{key:3,message:'exception\n  frame'},{key:1,message:'next'}];
  assert.deepEqual(selectedEntries(rows,new Set([1,99,3])),rows);
  assert.deepEqual(selectedEntries(rows,new Set([1])),[rows[1]]);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bufferSizes, resolveBufferSize, resolveTheme, resolveMessageOrder, readPreference, savePreference } from '../src/preferences';

test('saved preferences accept supported values and recover from invalid storage', () => {
  for (const size of bufferSizes) assert.equal(resolveBufferSize(String(size)), size);
  for (const value of [null, '', 'garbage', '-1', '999999999', 'NaN']) assert.equal(resolveBufferSize(value), 2000);
  for (const value of ['light', 'dark', 'system']) assert.equal(resolveTheme(value), value);
  assert.equal(resolveTheme('invalid'), 'system');
  assert.equal(resolveTheme(null), 'system');
  assert.equal(resolveMessageOrder('bottom'), 'bottom');
  for (const value of [null, 'top', 'invalid']) assert.equal(resolveMessageOrder(value), 'top');
});
test('unavailable browser storage does not prevent session preferences', () => {
  assert.equal(readPreference('theme'), null);
  assert.doesNotThrow(() => savePreference('theme', 'dark'));
});

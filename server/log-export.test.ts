import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serializeLogExport } from '../shared/log-export';
import type { Device } from '../shared/types';
import { selectedEntries } from '../shared/log-selection';

const device: Device = { id: 'test-device', name: 'Test phone', platform: 'android', state: 'connected' };

test('Android JSON preserves selected metadata, display order and multiline text without UI keys', () => {
  const rows = [
    { key: 3, timestamp: '2026-09-30T12:00:02.123Z', level: 'E', tag: 'App', pid: 0, message: 'Error: "failed"\n\tat C:\\app ☃' },
    { key: 2, timestamp: '2026-09-30T12:00:01.123Z', message: 'hidden' },
    { key: 1, timestamp: '2026-09-30T12:00:00.123Z', level: 'I', tag: '', pid: 12, message: 'first' },
  ];
  const result = serializeLogExport(selectedEntries(rows, new Set([1, 3, 99])), device, 'json');
  assert.equal(result.mimeType, 'application/json;charset=utf-8');
  assert.equal(result.extension, 'json');
  assert.deepEqual(JSON.parse(result.text), {
    schemaVersion: 1,
    device: { id: device.id, name: device.name, platform: 'android' },
    source: 'android-logcat', timestampSource: 'device',
    entries: [rows[0], rows[2]].map(({ key, ...entry }) => entry),
  });
});

test('iOS JSON retains raw syslog and identifies host receipt timestamps without inventing metadata', () => {
  const entries = [{ timestamp: '2026-09-30T12:00:00.000Z', message: 'Sep 30 13:59:59 Phone App[42] <Notice>: hello\ncontinued' }];
  const result = JSON.parse(serializeLogExport(entries, { ...device, platform: 'ios' }, 'json').text);
  assert.equal(result.device.platform, 'ios');
  assert.equal(result.source, 'ios-syslog');
  assert.equal(result.timestampSource, 'host-receipt');
  assert.deepEqual(result.entries, entries);
});

test('plain text retains existing formatting for both platforms and correct download metadata', () => {
  const android = serializeLogExport([{ timestamp: 'time', message: 'error\n  frame', level: 'E', tag: 'App', pid: 42 }], device, 'text');
  assert.deepEqual(android, { text: 'time E App[42]: error\n  frame', mimeType: 'text/plain;charset=utf-8', extension: 'log' });
  assert.equal(serializeLogExport([{ timestamp: 'receipt', message: 'original syslog' }], { ...device, platform: 'ios' }, 'text').text, 'receipt original syslog');
});

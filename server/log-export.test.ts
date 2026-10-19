import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serializeLogExport } from '../shared/log-export';
import type { Device } from '../shared/types';
import { selectedEntries } from '../shared/log-selection';

const device: Device = { id: 'test-device', name: 'Test phone', platform: 'android', state: 'connected' };

for (const format of ['text', 'json'] as const) {
  for (const newestPosition of ['top', 'bottom'] as const) {
    for (const selection of [false, true]) {
      test(`${format} export puts newest entries last with newest at ${newestPosition}, selection=${selection}`, () => {
        const source = { key: 'phone', name: device.name, platform: device.platform, deviceId: device.id };
        const chronological = [
          { key: 1, timestamp: '2026-10-19T10:00:00Z', message: 'first\n  frame', source },
          { key: 2, timestamp: '2026-10-19T10:00:00Z', message: 'second', source },
          { key: 3, timestamp: '2026-10-19T10:00:01Z', message: 'third', source },
        ];
        const displayed = newestPosition === 'top' ? [...chronological].reverse() : [...chronological];
        const rows = selection ? selectedEntries(displayed, new Set([1, 3])) : displayed;
        const before = [...rows];
        const expected = selection ? [chronological[0]!, chronological[2]!] : chronological;
        const exported = serializeLogExport(rows, device, format, newestPosition);
        if (format === 'json') {
          assert.deepEqual(JSON.parse(exported.text).entries, expected.map(({ key, ...entry }) => entry));
        } else {
          assert.equal(exported.text, expected.map(entry => `[${source.name}] ${entry.timestamp} ${entry.message}`).join('\n'));
        }
        assert.deepEqual(rows, before, 'Export must not reorder the viewer data');
      });
    }
  }
}

test('Android JSON exports selected metadata and multiline text oldest first without UI keys', () => {
  const rows = [
    { key: 3, timestamp: '2026-09-30T12:00:02.123Z', level: 'E', tag: 'App', pid: 0, message: 'Error: "failed"\n\tat C:\\app ☃' },
    { key: 2, timestamp: '2026-09-30T12:00:01.123Z', message: 'hidden' },
    { key: 1, timestamp: '2026-09-30T12:00:00.123Z', level: 'I', tag: '', pid: 12, message: 'first' },
  ];
  const result = serializeLogExport(selectedEntries(rows, new Set([1, 3, 99])), device, 'json', 'top');
  assert.equal(result.mimeType, 'application/json;charset=utf-8');
  assert.equal(result.extension, 'json');
  assert.deepEqual(JSON.parse(result.text), {
    schemaVersion: 1,
    device: { id: device.id, name: device.name, platform: 'android' },
    source: 'android-logcat', timestampSource: 'device',
    entries: [rows[2], rows[0]].map(({ key, ...entry }) => entry),
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

test('interleaved JSON preserves source metadata oldest first, excluding UI selection keys', () => {
  const phone = { key: 'phone', name: device.name, platform: device.platform, deviceId: device.id };
  const web = { ...phone, key: 'web', name: 'Slot', webview: { id: 'target', socket: 'socket', title: 'Slot', url: 'https://example.org' } };
  const rows = [
    { key: 8, timestamp: 'time2', message: 'web\n  original', source: web },
    { key: 5, timestamp: 'time1', message: 'native', source: phone },
  ];
  const parsed = JSON.parse(serializeLogExport(selectedEntries(rows, new Set([5, 8])), device, 'json', 'top').text);
  assert.equal(parsed.schemaVersion, 2);
  assert.deepEqual(parsed.sources, [phone, web]);
  assert.deepEqual(parsed.entries, [...rows].reverse().map(({ key, ...entry }) => entry));
  assert.equal(serializeLogExport(rows, device, 'text', 'top').text, '[Test phone] time1 native\n[Slot] time2 web\n  original');
  assert.equal(JSON.parse(serializeLogExport(rows.slice(0, 1), device, 'json').text).schemaVersion, 2);
});

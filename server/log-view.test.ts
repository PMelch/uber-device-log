import assert from 'node:assert/strict';
import test from 'node:test';
import { filterLogLevels, formatLogMessages, logExportText, logLevel, parseLogStack } from '../shared/log-view';
import { createLogSearch } from '../shared/search';
import * as logView from '../shared/log-view';
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
test('metadata filters match whole case-sensitive tags and numeric PIDs, never message text', () => {
  const records = [...entries, { timestamp: 't4', tag: 'UnityAds', pid: 123, message: 'Unity PID 12 failed' }];
  assert.deepEqual(logView.filterLogMetadata(records, 'android', ' Unity ', ''), [entries[0], entries[1]]);
  assert.deepEqual(logView.filterLogMetadata(records, 'android', 'unity', ''), []);
  assert.deepEqual(logView.filterLogMetadata(records, 'android', '', '12'), [entries[1]]);
  assert.deepEqual(logView.filterLogMetadata(records, 'android', '', ' 00012 '), [entries[1]]);
  assert.deepEqual(logView.filterLogMetadata(records, 'android', 'UnityAds', '12'), []);
  assert.deepEqual(logView.filterLogMetadata(records, 'android', '', '0'), [entries[0]]);
  assert.deepEqual(logView.filterLogMetadata(records, 'android', '', ''), records);
  assert.equal(records[3]?.message, 'Unity PID 12 failed');
});
test('invalid PID filters match no Android rows but are ignored for other platforms', () => {
  for (const pid of ['abc', '-1', '1.2', '1e2', '12 3', '１２', '9007199254740992']) {
    assert.equal(logView.isLogPidFilterValid(pid), false, pid);
    assert.deepEqual(logView.filterLogMetadata(entries, 'android', '', pid), [], pid);
    assert.deepEqual(logView.filterLogMetadata(entries, 'ios', 'Unity', pid), entries, pid);
    assert.deepEqual(logView.filterLogMetadata(entries, undefined, 'Unity', pid), entries, pid);
  }
  for (const pid of ['', ' ', '0', '0012', '9007199254740991']) assert.equal(logView.isLogPidFilterValid(pid), true, pid);
});
test('search, metadata and severity combine while preserving export order and multiline messages', () => {
  const searched = createLogSearch(entries)('FAILED', 'literal');
  const metadata = logView.filterLogMetadata(searched, 'android', 'Unity', '12');
  const result = filterLogLevels(metadata, 'android', ['ERROR']);
  assert.deepEqual(result, [entries[1]]);
  assert.equal(formatLogMessages(result), 't2 E Unity[12]: failed\n  stack');
  assert.deepEqual(filterLogLevels(metadata, 'android', ['INFO']), []);
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

test('Java stack traces distinguish frames, source locations, causes and omitted frames', () => {
  const message = 'Error parsing mDNS packet\n'
    + 'android.net.mdns.MdnsPacket$ParseException: Failed to read NSEC record.\n'
    + '\tat android.net.mdns.MdnsPacket.parseRecord(MdnsPacket.java:234)\n'
    + '\tat android.os.MessageQueue.nativePollOnce(Native Method)\n'
    + 'Caused by: java.io.IOException: Invalid bitmap length: 33\n'
    + '&#x9;at android.net.mdns.MdnsRecord.<init>(MdnsRecord.java:93)\n'
    + '&#x9;... 16 more';
  const lines = parseLogStack(message)!;
  assert.deepEqual(lines.map(line => line.kind), ['message', 'exception', 'frame', 'frame', 'cause', 'frame', 'omitted']);
  assert.deepEqual(lines[2], { kind: 'frame', text: '\tat android.net.mdns.MdnsPacket.parseRecord', location: '(MdnsPacket.java:234)' });
  assert.equal(lines[3]?.location, '(Native Method)');
  assert.equal(lines[5]?.text, '\tat android.net.mdns.MdnsRecord.<init>');
  assert.equal(lines[6]?.text, '\t... 16 more');
  const entry = { timestamp: 't', level: 'E', message };
  assert.equal(logExportText([entry], ''), `t E: ${message}`);
  assert.deepEqual(createLogSearch([entry])('bitmap'), [entry]);
});

test('ordinary multiline logs and HTML-like text remain untouched', () => {
  for (const message of ['', 'hello', 'first\nsecond', 'meet at noon (office)', '<script>alert(1)</script>\n&#x9;text']) {
    assert.equal(parseLogStack(message), undefined);
  }
});

test('stack formatting supports CRLF, suppressed exceptions and standalone frames', () => {
  const lines = parseLogStack('java.lang.RuntimeException: failed\r\n\tSuppressed: java.io.IOException: closed\r\n\t\tat a.b.run(Unknown Source)\r\n\t\t... 2 more')!;
  assert.deepEqual(lines.map(line => line.kind), ['exception', 'cause', 'frame', 'omitted']);
  assert.equal(lines[2]?.text, '\t\tat a.b.run');
  assert.equal(parseLogStack('&#9;at a.b.run(File.java:1)')?.[0]?.location, '(File.java:1)');
});

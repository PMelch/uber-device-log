import { test, expect } from 'bun:test';
import { formatLogMessages } from '../shared/log-view';
import { languages, translate } from '../src/i18n';
import { renderLogDetails } from './log-details';

const base = { timestamp: '2026-11-04T12:00:00Z', level: 'ERROR', tag: 'Files', pid: 42 };
test('details use the shared parsed file-error fields and localized explanation', () => {
  const record = { ...base, message: 'readFile /tmp/cart.json failed: java.io.FileNotFoundException: /tmp/cart.json: open failed: ENOENT (No such file or directory)' };
  const text = renderLogDetails(record, 'fields', 'en');
  expect(text).toContain('File path: /tmp/cart.json');
  expect(text).toContain('Error code: ENOENT');
  expect(text).toContain('This entry alone does not establish a hardware fault');
  expect(renderLogDetails(record, 'fields', 'de')).not.toContain('File path:');
  expect(renderLogDetails(record, 'raw', 'en')).toBe(formatLogMessages([record]));
  expect(JSON.parse(renderLogDetails(record, 'json', 'en')).original.message).toBe(record.message);
});
test('iOS details distinguish received time, parsed header and redaction without mutating logs', () => {
  const record = { ...base, message: 'Nov  4 12:00:00 phone kernel(AppleSPU)[12] <Error>: Error setting grimaldi power state <private>', source: { key: 'ios:demo', name: 'Phone', deviceId: 'demo', platform: 'ios' as const } };
  const original = JSON.stringify(record);
  const text = renderLogDetails(record, 'fields', 'en');
  expect(text).toContain('Received (host):');
  expect(text).toContain('Process: kernel');
  expect(text).toContain('Component / library: AppleSPU');
  expect(text).toContain('marks redacted content');
  expect(JSON.stringify(record)).toBe(original);
});
test('all detail views escape terminal control bytes only in presentation', () => {
  const record = { ...base, message: 'literal \\n\nactual\x1b[2J' };
  for (const mode of ['fields', 'raw', 'json'] as const) expect(renderLogDetails(record, mode, 'en')).not.toContain('\x1b');
  expect(renderLogDetails(record, 'fields', 'en')).toContain('literal \\n\nactual\\u001b[2J');
  expect(record.message).toContain('\x1b');
});

test('JSON retains source identity and capture truncation metadata', () => {
  const record = { ...base, message: 'partial', truncated: true, source: { key: 'android:demo', name: 'Phone', deviceId: 'demo', platform: 'android' as const } };
  const json = JSON.parse(renderLogDetails(record, 'json', 'en'));
  expect(json.original.truncated).toBe(true);
  expect(json.original.source).toEqual(record.source);
});

test('generic details omit interpretation while retaining metadata, original and independent notices', () => {
  for (const { code } of languages) {
    const record = { ...base, message: 'ordinary log <private>' };
    const text = renderLogDetails(record, 'fields', code);
    expect(text).not.toContain(translate(code, 'detailInterpretation'));
    expect(text).not.toContain(translate(code, 'detailGeneric'));
    expect(text).toContain(translate(code, 'detailPrivate'));
    expect(text).toContain(record.message);
    expect(text).toContain(base.timestamp);
  }
});

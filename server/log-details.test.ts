import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpretLog, logDetailsJson } from '../shared/log-details';

const timestamp = '2026-09-30T08:53:00.448Z';
const line = 'Sep 30 10:53:00 TestPhone appleh16camerad(libEmbeddedSystemAUs.dylib)[129] <Notice>:            AURemoteIO.cpp:1727  workgroup port 0x574b';

test('iOS envelope extracts explicit fields and source location without inventing a date or mutating the original', () => {
  const entry = Object.freeze({ timestamp, message: line });
  const details = interpretLog(entry, 'ios');
  assert.equal(details.format, 'ios-syslog');
  assert.equal(details.deviceTimestamp, 'Sep 30 10:53:00');
  assert.equal(details.host, 'TestPhone');
  assert.equal(details.process, 'appleh16camerad');
  assert.equal(details.component, 'libEmbeddedSystemAUs.dylib');
  assert.equal(details.pid, '129');
  assert.equal(details.level, 'Notice');
  assert.equal(details.sourceLocation, 'AURemoteIO.cpp:1727');
  assert.equal(details.interpretation, 'audio');
  assert.equal(entry.message, line);
});
test('missing iOS headers never borrow metadata, including fragments, malformed headers and arbitrary JSON', () => {
  for (const message of ['input client: 2 ch, 48000 Hz, Float32', '}', 'Sep 30 10:53:00 TestPhone App[invalid] <Error>: failure', '{"process":"App","pid":42}', '<img src=x onerror=alert(1)>']) {
    const details = interpretLog({ timestamp, message }, 'ios');
    assert.equal(details.format, 'unrecognized');
    assert.equal(details.body, message);
    assert.equal(details.process, undefined);
    assert.equal(details.pid, undefined);
    assert.equal(details.level, undefined);
  }
});
test('optional components, single-digit days, kernel PID zero, private markers and multiline text survive parsing', () => {
  const message = 'Sep  3 01:02:03 Phone kernel[0] <Error>: <private>\n  more text';
  const details = interpretLog({ timestamp, message }, 'ios');
  assert.equal(details.component, undefined);
  assert.equal(details.pid, '0');
  assert.equal(details.hasPrivateData, true);
  assert.equal(details.body, '<private>\n  more text');
  assert.equal(details.deviceTimestamp, 'Sep  3 01:02:03');
});
test('Android uses captured metadata and never misinterprets syslog-looking message content as an iOS envelope', () => {
  const entry = { timestamp, message: line, pid: 0, tag: 'App', level: 'E', key: 999 };
  const parsed = interpretLog(entry, 'android');
  assert.equal(parsed.format, 'android-structured');
  assert.equal(parsed.pid, '0');
  assert.equal(parsed.tag, 'App');
  assert.equal(parsed.level, 'E');
  assert.equal(parsed.process, undefined);
  const json = JSON.parse(logDetailsJson(entry, 'android', parsed));
  assert.equal(json.timestampSource, 'device');
  assert.equal(json.original.message, line);
  assert.equal(json.original.key, undefined);
  assert.equal(json.original.pid, 0);
});
test('interpretations are constrained to observed source and message patterns', () => {
  const cases = [
    ['appleh16camerad', 'GetLuxInfo: Scheduling the lux query', 'lux'],
    ['wifid(WiFiPolicy)', 'Appended kWiFiUsageFaultReasonSlowWiFiDnsFailure', 'dns'],
    ['kernel(AppleSPU)', 'Error setting grimaldi power state', 'power'],
    ['mobileassetd(MobileAssetDaemon)', 'invalid type for input:(null)', 'invalidType'],
    ['backboardd(CoreBrightness)', 'HDR | Trusted.Lux=191.485', 'brightness'],
    ['OtherApp', 'GetLuxInfo: Scheduling the lux query', 'generic'],
    ['OtherApp', 'Error setting grimaldi power state', 'generic'],
  ];
  for (const [source, body, expected] of cases) {
    const result = interpretLog({ timestamp, message: `Sep 30 10:53:00 Phone ${source}[42] <Error>: ${body}` }, 'ios');
    assert.equal(result.interpretation, expected);
  }
});
test('diagnostic JSON preserves escaped text and distinguishes host receipt time from device time', () => {
  const entry = { timestamp, message: line + '\n\t"quoted" \\path ☃ <private>' };
  const json = JSON.parse(logDetailsJson(entry, 'ios', interpretLog(entry, 'ios')));
  assert.equal(json.timestampSource, 'host-receipt');
  assert.deepEqual(json.original, entry);
  assert.equal(json.parsed.deviceTimestamp, 'Sep 30 10:53:00');
  assert.equal(json.parsed.hasPrivateData, true);
});
test('Android exception traces reuse existing diagnostic recognition without changing message text', () => {
  const entry = { timestamp, message: 'java.lang.IllegalStateException: failed\n\tat app.Main.run(Main.java:3)' };
  const result = interpretLog(entry, 'android');
  assert.equal(result.interpretation, 'stack');
  assert.equal(result.body, entry.message);
});

test('file read failure is structured without losing text or assuming a hardware fault', () => {
  const path = '/sys/devices/platform/exynos-drm/secondary-panel/panel_name';
  const message = `readFile ${path} failed: java.io.FileNotFoundException: ${path}: open failed: ENOENT (No such file or directory)`;
  const entry = { timestamp, message, level: 'E', tag: 'LIBHWINFO', pid: 17228 };
  const parsed = interpretLog(entry, 'android');
  assert.equal(parsed.interpretation, 'fileRead');
  assert.equal(parsed.fileFailure?.operation, 'readFile');
  assert.equal(parsed.fileFailure?.path, path);
  assert.equal(parsed.fileFailure?.exception, 'java.io.FileNotFoundException');
  assert.equal(parsed.fileFailure?.errorCode, 'ENOENT');
  assert.equal(parsed.fileFailure?.reason, 'No such file or directory');
  assert.equal(parsed.fileFailure?.segments.join(''), message);
  assert.equal(parsed.body, message);
  const json = JSON.parse(logDetailsJson(entry, 'android', parsed));
  assert.deepEqual(json.original, entry);
  assert.equal(json.parsed.fileFailure.path, path);
  const denied = interpretLog({ timestamp, message: message.replace('ENOENT (No such file or directory)', 'EACCES (Permission denied)') }, 'android');
  assert.equal(denied.fileFailure?.errorCode, 'EACCES');
  for (const invalid of [message.replace(`Exception: ${path}`, 'Exception: /different'), message + '\nadditional text', 'FileNotFoundException: unknown']) {
    assert.equal(interpretLog({ timestamp, message: invalid }, 'android').fileFailure, undefined);
  }
});

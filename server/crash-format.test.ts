import assert from 'node:assert/strict';
import test from 'node:test';
import { parseLogStack, formatLogMessages } from '../shared/log-view';
import { androidCrashSamples, iosCrashSamples, ipsSample } from './fixtures/crash-messages';

test('Android Java, native tombstone, allocator, ANR and Unity examples get semantic formatting', () => {
  for (const example of androidCrashSamples) assert.ok(parseLogStack(example.message), example.name);
  const native = parseLogStack(androidCrashSamples[1]!.message)!;
  assert.ok(native.some(line => line.kind === 'signal'));
  assert.ok(native.some(line => line.kind === 'registers'));
  assert.equal(native.filter(line => line.kind === 'native-frame').length, 2);
  assert.ok(parseLogStack(androidCrashSamples[3]!.message)!.some(line => line.kind === 'thread'));
});
test('Apple Objective-C, Swift, native, watchdog and jetsam diagnostics get semantic formatting', () => {
  for (const example of iosCrashSamples) assert.ok(parseLogStack(example.message), example.name);
  const objc = parseLogStack(iosCrashSamples[0]!.message)!;
  assert.equal(objc[0]?.kind, 'exception');
  assert.equal(objc.filter(line => line.kind === 'native-frame').length, 3);
  const native = parseLogStack(iosCrashSamples[2]!.message)!;
  assert.ok(native.some(line => line.kind === 'signal'));
  assert.ok(native.some(line => line.kind === 'registers'));
});
test('split native and prefixed iOS records are recognized without merging unrelated records', () => {
  for (const message of ['Fatal signal 11 (SIGSEGV), code 1, fault addr 0x0 in tid 29 (worker)', '#00 pc 00001234 /data/app/libscene.so (draw+32)', 'Sep 30 08:23:10 iPhone CrashDemo[242] <Error>: 0   CrashDemo  0x0000000100120000 render + 48', 'libc++abi: terminating due to uncaught exception of type std::runtime_error']) {
    assert.ok(parseLogStack(message), message);
  }
});
test('recognized IPS JSON preserves every field while ordinary and incomplete JSON stays raw', () => {
  const parsed = parseLogStack(ipsSample);
  assert.ok(parsed?.some(line => line.kind === 'signal'));
  assert.ok(parsed?.some(line => (line.text + (line.location ?? '')).includes('imageOffset')));
  assert.equal(parseLogStack('{"message":"normal JSON","exception":null}'), undefined);
  assert.equal(parseLogStack('{"bug_type":"309"}\n{"exception":'), undefined);
});
test('raw text, addresses, prefixes and HTML remain intact for rendering and full-log export', () => {
  for (const example of [...androidCrashSamples, ...iosCrashSamples]) {
    const parsed = parseLogStack(example.message)!;
    assert.equal(parsed.map(line => line.text + (line.location ?? '')).join('\n'), example.message);
    assert.equal(formatLogMessages([{ timestamp: 't', message: example.message }]), `t ${example.message}`);
  }
  for (const message of ['signal strength: 11', 'Exception handling completed successfully', 'Thread pool ready', '0 apples 1234 remaining', 'Fatal error rate is 0%', 'report: EXC_BAD_ACCESS explained']) assert.equal(parseLogStack(message), undefined, message);
});

test('individual signal, abort, sanitizer, register and thread lines survive split stream records', () => {
  for (const message of [
    "Abort message: 'assertion failed'", 'Cause: seccomp prevented call to disallowed system call 999',
    'signal 7 (SIGBUS), code 1 (BUS_ADRALN), fault addr 0x4',
    'signal 31 (SIGSYS), code 1 (SYS_SECCOMP), fault addr --------',
    'JNI DETECTED ERROR IN APPLICATION: use of deleted local reference',
    '==242==ERROR: AddressSanitizer: heap-use-after-free on address 0x0010',
    'ERROR: HWAddressSanitizer: tag-mismatch on address 0x1234',
    'FORTIFY: memcpy: prevented write past end of buffer',
    '    x0  0000000000000000  x1  0000007a12001000', 'Thread 1:',
    'Binary Images:', 'Caused by: custom.DomainFailure: failed',
  ]) assert.ok(parseLogStack(message), message);
});
test('IPS layout retains unsafe-integer addresses and escaped strings; excessive nesting stays raw', () => {
  const source = '{"exception":{"type":"EXC_BAD_ACCESS"},"threads":[],"address":18446744073709551615,"note":"a\\\\b\\n\\\"c"}';
  const layout = parseLogStack(source)!.map(line => line.text).join('\n');
  assert.match(layout, /18446744073709551615/);
  assert.deepEqual(JSON.parse(layout), JSON.parse(source));
  const nested = '{"exception":{"type":"EXC_BAD_ACCESS"},"threads":[],"extra":' + '['.repeat(100) + '0' + ']'.repeat(100) + '}';
  assert.equal(parseLogStack(nested), undefined);
});

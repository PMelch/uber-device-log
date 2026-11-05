import assert from 'node:assert/strict';
import test from 'node:test';
import { PassThrough } from 'node:stream';
import * as processes from './android-processes.js';

test('process list preserves full package and secondary process names', () => {
  assert.equal(typeof processes.parseAndroidProcesses, 'function');
  assert.deepEqual(processes.parseAndroidProcesses('  PID NAME\r\n 123 com.example.app\n 456 com.example.app:worker\n'), [
    { pid: 123, name: 'com.example.app' }, { pid: 456, name: 'com.example.app:worker' },
  ]);
  assert.deepEqual(processes.parseAndroidProcesses('PID NAME\n'), []);
  assert.throws(() => processes.parseAndroidProcesses('ps: unknown option -o'));
  assert.throws(() => processes.parseAndroidProcesses('PID NAME\n0 invalid\n'));
});

test('discovery uses a fixed command and closes its stream', async () => {
  const stream = new PassThrough();
  const pending = processes.discoverAndroidProcesses({ shell: async command => {
    assert.equal(command, 'ps -A -o PID,NAME');
    stream.end('PID NAME\n42 com.example.app\n'); return stream;
  } });
  assert.deepEqual(await pending, [{ pid: 42, name: 'com.example.app' }]);
  assert.equal(stream.destroyed, true);
});

test('hung discovery and late streams are cleaned up', async () => {
  const stream = new PassThrough();
  await assert.rejects(processes.discoverAndroidProcesses({ shell: async () => stream }, 15), /timed out/);
  assert.equal(stream.destroyed, true);
  const late = new PassThrough();
  await assert.rejects(processes.discoverAndroidProcesses({ shell: () => new Promise(resolve => setTimeout(() => resolve(late), 30)) }, 5), /timed out/);
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(late.destroyed, true);
});

test('process names can contain spaces, including Android kernel worker names', () => {
  assert.deepEqual(processes.parseAndroidProcesses('  PID NAME                       \r\n 1633 [irq/510-cs40l26 IRQ1 Controller]   \r\n 2000 com.example.app\r\n'), [
    { pid: 1633, name: '[irq/510-cs40l26 IRQ1 Controller]' },
    { pid: 2000, name: 'com.example.app' },
  ]);
  assert.throws(() => processes.parseAndroidProcesses('PID NAME\n 1633    \n'));
});

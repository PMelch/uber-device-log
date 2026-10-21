import assert from 'node:assert/strict';
import test from 'node:test';
import { deviceSetup } from './device-setup.js';
import type { Device } from '../shared/types.js';

const ok = (value: Device[] = []): PromiseFulfilledResult<Device[]> => ({ status: 'fulfilled', value });
const fail = (reason: unknown): PromiseRejectedResult => ({ status: 'rejected', reason });
test('setup uses the server OS and does not treat an empty device list as a missing dependency', () => {
  for (const [platform, host] of [['win32','windows'], ['darwin','macos'], ['linux','linux'], ['freebsd','other']] as const) {
    assert.deepEqual(deviceSetup([ok(), ok()], platform), { host, issues: [] });
  }
});
test('missing Android executable and unreachable iOS transport remain separate, structured issues', () => {
  const missing = Object.assign(new Error('spawn /custom/adb ENOENT'), { code: 'ENOENT', syscall: 'spawn /custom/adb' });
  assert.deepEqual(deviceSetup([fail(missing), fail(new Error('ECONNREFUSED 127.0.0.1:27015'))], 'win32'), {
    host: 'windows', issues: [
      { platform: 'android', reason: 'adbMissing', detail: missing.message },
      { platform: 'ios', reason: 'iosUnavailable', detail: 'ECONNREFUSED 127.0.0.1:27015' },
    ],
  });
  assert.equal(deviceSetup([fail(new Error('ADB server refused connection')), ok()], 'linux').issues[0]?.reason, 'androidUnavailable');
  assert.equal(deviceSetup([fail(Object.assign(new Error('socket absent'), { code: 'ENOENT', syscall: 'connect' })), ok()], 'linux').issues[0]?.reason, 'androidUnavailable');
});
test('unauthorized and permission-denied devices receive help without hiding connected devices', () => {
  const devices: Device[] = [
    {id:'authorized', name:'Pixel', platform:'android', state:'connected'},
    {id:'waiting', name:'Phone', platform:'android', state:'unauthorized'},
    {id:'denied', name:'Tablet', platform:'android', state:'no permissions'},
    {id:'waiting2', name:'Another phone', platform:'android', state:'unauthorized'},
  ];
  const before = structuredClone(devices);
  assert.deepEqual(deviceSetup([ok(devices), ok()], 'linux').issues.map(issue => issue.reason), ['androidUnauthorized', 'androidPermissions']);
  assert.deepEqual(devices, before);
  assert.deepEqual(deviceSetup([ok(), ok()], 'linux').issues, []);
});

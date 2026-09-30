import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRememberedDevice, lastDeviceKey } from '../src/remembered-device';
import type { Device } from '../shared/types';
const android: Device = { id: 'same-id', name: 'Phone', platform: 'android', state: 'connected' };
const ios: Device = { ...android, platform: 'ios' };

test('last device survives absence and is restored on a later reload, not background polling', () => {
  const storage = new Map<string, string>();
  const page = () => createRememberedDevice(key => storage.get(key) ?? null, (key, value) => { storage.set(key, value); });
  const first = page();
  assert.equal(first.restoreOnce([android]), '');
  first.remember(android);
  assert.equal(storage.get(lastDeviceKey), 'android:same-id');
  assert.equal(page().restoreOnce([ios, android]), 'android:same-id');
  const absent = page();
  assert.equal(absent.restoreOnce([ios]), '');
  absent.remember(undefined);
  assert.equal(storage.get(lastDeviceKey), 'android:same-id');
  assert.equal(absent.restoreOnce([android]), '');
  assert.equal(page().restoreOnce([android]), 'android:same-id');
  absent.remember(ios);
  assert.equal(page().restoreOnce([android, ios]), 'ios:same-id');
});
test('unavailable devices and invalid saved keys are not automatically selected', () => {
  for (const state of ['offline', 'unauthorized', 'disconnected']) {
    const preference = createRememberedDevice(() => 'android:same-id', () => assert.fail('Unavailable device must not overwrite storage'));
    const device = { ...android, state };
    assert.equal(preference.restoreOnce([device]), '');
    preference.remember(device);
  }
  for (const saved of [null, '', 'garbage', 'ios:other']) {
    assert.equal(createRememberedDevice(() => saved).restoreOnce([android, ios]), '');
  }
});

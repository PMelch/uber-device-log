import assert from 'node:assert/strict';
import test from 'node:test';
import { createUpdatePreference } from '../src/update-preference';

const day = 24 * 60 * 60 * 1000;
function fixture() {
  const data = new Map<string, string>();
  let now = 1000;
  const dependencies = { now: () => now, storage: () => ({ getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } }) };
  return { data, dependencies, at: (value: number) => { now = value; } };
}
test('remind later persists exactly 24 hours and expires on refresh', () => {
  const f = fixture(); const preference = createUpdatePreference(f.dependencies);
  preference.hide('1.1.0', 'later');
  assert.equal(preference.isHidden('1.1.0'), true);
  f.at(1000 + day - 1);
  const reloaded = createUpdatePreference(f.dependencies);
  assert.equal(reloaded.isHidden('1.1.0'), true);
  f.at(1000 + day);
  assert.equal(reloaded.isHidden('1.1.0'), false);
});
test('dismiss persists permanently but neither action hides a newer version', () => {
  const f = fixture(); const preference = createUpdatePreference(f.dependencies);
  for (const action of ['later', 'dismiss'] as const) {
    preference.hide('1.1.0', action);
    assert.equal(preference.isHidden('1.2.0'), false);
  }
  f.at(1000 + 1000 * day);
  assert.equal(createUpdatePreference(f.dependencies).isHidden('1.1.0'), true);
});
test('malformed stored values fail open', () => {
  const f = fixture(); const preference = createUpdatePreference(f.dependencies);
  preference.hide('1.1.0', 'later'); const key = [...f.data.keys()][0]!;
  for (const value of ['oops', 'null', '[]', '{}', '{"until":"999999999"}', '{"until":-1}', '{"dismissed":"yes"}', '{"until":1e999}']) {
    f.data.set(key, value);
    assert.equal(createUpdatePreference(f.dependencies).isHidden('1.1.0'), false, value);
  }
});
test('unavailable storage and failed writes retain working in-session actions', () => {
  for (const storage of [() => { throw Error('denied'); }, () => ({getItem: () => {throw Error('denied');}, setItem: () => {throw Error('quota');}}), () => ({getItem: () => null, setItem: () => {throw Error('quota');}})]) {
    let now = 1000; const preference = createUpdatePreference({storage, now: () => now});
    assert.equal(preference.isHidden('1.1.0'), false);
    preference.hide('1.1.0', 'later'); assert.equal(preference.isHidden('1.1.0'), true);
    now += day; assert.equal(preference.isHidden('1.1.0'), false);
    preference.hide('1.1.0', 'dismiss'); now += day;
    assert.equal(preference.isHidden('1.1.0'), true);
    assert.equal(preference.isHidden('1.2.0'), false);
  }
});

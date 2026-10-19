import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';

test('update notice is mounted in the header and localizes versions, instructions and changelog', () => {
  assert.ok(existsSync('src/components/UpdateNotice.vue'), 'startup update notice must exist');
  const notice = readFileSync('src/components/UpdateNotice.vue', 'utf8');
  const app = readFileSync('src/App.vue', 'utf8');
  assert.match(app, /<UpdateNotice[^>]+:t="t"/);
  for (const key of ['updateAvailable', 'updateChangelog', 'updateInstructions', 'updateUnknown', 'updateDismiss']) assert.ok(notice.includes(`t('${key}'`));
  assert.match(notice, /role="status"/);
});

test('startup polling waits for the background check and cancels on disposal', async () => {
  assert.ok(existsSync('src/update-check.ts'), 'startup update polling must exist');
  const { pollForUpdate } = await import('../src/update-check');
  const requests: AbortSignal[] = [];
  const results: unknown[] = [];
  let scheduled: (() => void) | undefined;
  let cleared = false;
  const stop = pollForUpdate(value => results.push(value), {
    fetch: async (_url, options) => { requests.push(options.signal); return { ok: true, json: async () => ({ status: requests.length === 1 ? 'checking' : 'available', currentVersion: '1.0.0', latestVersion: '1.1.0', installation: 'npx', commands: ['npx uber-device-log@latest'], changelogUrl: null }) }; },
    schedule: callback => { scheduled = callback; return 1 as unknown as ReturnType<typeof setTimeout>; },
    cancel: () => { cleared = true; },
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(results.length, 0);
  assert.ok(scheduled);
  scheduled();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(results.length, 1);
  stop();
  assert.equal(cleared, true);
  assert.ok(requests.every(signal => signal.aborted));
});

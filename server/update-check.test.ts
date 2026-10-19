import { test } from 'node:test';
import assert from 'node:assert/strict';

test('update checker detects launchers and compares stable releases', async () => {
  const { detectInstallation, isNewerVersion, updateCommands } = await import('./update-check.js');
  assert.equal(detectInstallation('/home/a/.npm/_npx/abc/node_modules/uber-device-log', {}), 'npx');
  assert.equal(detectInstallation('/home/a/.bun/install/cache/uber-device-log@0.8.0', {}), 'bunx');
  assert.equal(detectInstallation('/home/a/.bun/install/global/node_modules/uber-device-log', {}), 'bun-global');
  assert.equal(detectInstallation('/usr/local/lib/node_modules/uber-device-log', {}), 'npm-global');
  assert.equal(detectInstallation('/work/uber-device-log', { npm_config_user_agent: 'npm/11' }), 'unknown');
  assert.equal(isNewerVersion('0.8.0', '0.9.0'), true);
  assert.equal(isNewerVersion('0.8.0', '0.8.0'), false);
  assert.equal(isNewerVersion('0.8.0', '0.7.9'), false);
  assert.equal(isNewerVersion('0.8.0', '0.9.0-beta.1'), false);
  assert.equal(isNewerVersion('0.8.0-beta.1', '0.8.0'), true);
  assert.deepEqual(updateCommands('npx'), ['npx --yes uber-device-log@latest']);
  assert.deepEqual(updateCommands('bunx'), ['bunx uber-device-log@latest']);
});

test('check starts without waiting, handles failure and timeout, and only advertises newer versions', async () => {
  const { createUpdateCheck } = await import('./update-check.js');
  let finish!: (value: Response) => void;
  const check = createUpdateCheck('0.8.0', 'unknown', () => new Promise(resolve => { finish = resolve; }));
  assert.equal(check.state.status, 'checking');
  finish(new Response(JSON.stringify({ version: '0.9.0' })));
  await check.done;
  assert.equal(check.state.status, 'available');
  assert.equal(check.state.latestVersion, '0.9.0');
  assert.match(check.state.changelogUrl!, /CHANGELOG.txt/);
  const failed = createUpdateCheck('0.8.0', 'unknown', async () => { throw Error('offline'); });
  await failed.done;
  assert.equal(failed.state.status, 'unavailable');
  const timeout = createUpdateCheck('0.8.0', 'unknown', () => new Promise(() => {}), 10);
  await timeout.done;
  assert.equal(timeout.state.status, 'unavailable');
  const old = createUpdateCheck('0.8.0', 'npx', async () => new Response('{"version":"0.7.0"}'));
  await old.done;
  assert.equal(old.state.status, 'current');
});


test('registry data is validated and never becomes a command or external link', async () => {
  const { createUpdateCheck, detectInstallation } = await import('./update-check.js');
  for (const body of ['{}', '{"version":"garbage"}', '{"version":"0.9.0-beta.1"}', '{"version":"0.9.0; curl example.com"}']) {
    const check = createUpdateCheck('0.8.0', 'npm-global', async (url, init) => {
      assert.equal(url, 'https://registry.npmjs.org/uber-device-log/latest');
      assert.equal(init?.redirect, 'error');
      assert.ok(init?.signal);
      return new Response(body);
    });
    await check.done;
    assert.equal(check.state.status, 'unavailable');
    assert.equal(check.state.changelogUrl, null);
    assert.deepEqual(check.state.commands, ['npm install -g uber-device-log@latest']);
  }
  const failed = createUpdateCheck('0.8.0', 'unknown', async () => new Response('{}', { status: 503 }));
  await failed.done;
  assert.equal(failed.state.status, 'unavailable');
  assert.equal(detectInstallation('/private/tmp/bunx-501-uber-device-log@latest/node_modules/uber-device-log', {}), 'bunx');
  assert.equal(detectInstallation('/custom/bun/node_modules/uber-device-log', { BUN_INSTALL_GLOBAL_DIR: '/custom/bun' }), 'bun-global');
  assert.equal(detectInstallation('C:\\Users\\alice\\AppData\\Roaming\\npm\\node_modules\\uber-device-log', {}), 'npm-global');
});

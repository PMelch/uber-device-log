import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { processRoutes } from './process-routes.js';

test('process endpoint validates the connected Android device and returns translatable failures', async () => {
  let calls = 0, fail = false;
  const app = express();
  app.use('/api/processes', processRoutes({
    androidDevices: async () => [{ id: 'phone', platform: 'android', name: 'Phone', state: fail ? 'unauthorized' : 'connected' }],
    listAndroidProcesses: async id => { calls++; assert.equal(id, 'phone'); return [{ pid: 12, name: 'example.app' }]; },
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const get = (query: string) => fetch(`http://127.0.0.1:${address.port}/api/processes${query}`);
  try {
    assert.equal((await get('')).status, 400);
    assert.equal((await get('?id=a&id=b')).status, 400);
    assert.equal((await get('?id=missing')).status, 409);
    assert.equal(calls, 0);
    const response = await get('?id=phone');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { processes: [{ pid: 12, name: 'example.app' }] });
    fail = true;
    const unavailable = await get('?id=phone');
    assert.equal(unavailable.status, 409);
    assert.equal((await unavailable.json()).code, 'processUnavailable');
    assert.equal(calls, 1);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

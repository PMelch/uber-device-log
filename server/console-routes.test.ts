import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createServer } from 'node:http';
import { consoleRoutes } from './console-routes.js';
import { RuntimeConsole } from './runtime-console.js';

test('console API validates discovered targets, JSON-only writes, private tokens and session cleanup', async () => {
  const runtime = new RuntimeConsole('android');
  let acquisitions = 0, releases = 0;
  const device = { platform: 'android' as const, id: 'phone', name: 'Phone', state: 'connected', webviews: [{ id: 'page', socket: 'socket', title: '', url: '' }] };
  const routes = consoleRoutes({ listDevices: async () => ({ devices: [device], warnings: [] }), acquireWebView: async () => { acquisitions++; return { runtime, release: () => { releases++; } }; } });
  const app = express(); app.use('/api/console', routes.router);
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/console`;
  const post = (path: string, value: unknown) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  try {
    assert.equal((await fetch(base, { method: 'POST', body: 'platform=android' })).status, 415);
    assert.equal((await post('', { platform: 'android', id: 'phone', socket: 'arbitrary', target: 'page' })).status, 409);
    assert.equal(acquisitions, 0);
    const response = await post('', { platform: 'android', id: 'phone', socket: 'socket', target: 'page' });
    const session = await response.json(); assert.equal(response.status, 200); assert.match(session.id, /^[\da-f-]{36}$/);
    assert.equal((await fetch(base + '/unknown')).status, 409);
    const missing = await post(`/${session.id}/execute`, { context: 'made-up', revision: 0, expression: 'x++' });
    assert.equal((await missing.json()).code, 'consoleStale');
    assert.equal((await fetch(base + '/' + session.id, { method: 'DELETE' })).status, 204);
    assert.equal(releases, 1);
    assert.equal((await fetch(base + '/' + session.id)).status, 409);
  } finally { routes.close(); server.close(); server.closeAllConnections(); }
});

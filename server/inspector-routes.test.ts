import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createServer } from 'node:http';
import * as routes from './inspector-routes';
const device = { id: 'phone', platform: 'android' as const, state: 'connected', name: 'Phone', webviews: [{ id: 'page', socket: 'webview_devtools_remote_1', title: '', url: '' }] };
test('inspector validates current Android target, reuses access, and releases on shutdown', async () => {
  assert.equal(typeof routes.inspectorRoutes, 'function');
  let opened = 0; let closed = 0;
  const inspector = routes.inspectorRoutes({ listDevices: async () => ({ devices: [device], warnings: [] }), openInspector: async () => { opened++; return { url: 'https://devtools.test/inspector', close: () => { closed++; } }; } });
  const app = express(); app.use(inspector.router);
  const server = createServer(app); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const post = (body: unknown) => fetch(`http://127.0.0.1:${address.port}/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    assert.equal((await post({ platform: 'ios', id: 'phone', socket: device.webviews[0].socket, target: 'page' })).status, 409);
    assert.equal((await post({ platform: 'android', id: 'phone', socket: device.webviews[0].socket, target: 'missing' })).status, 409);
    for (let i = 0; i < 2; i++) assert.deepEqual(await (await post({ platform: 'android', id: 'phone', socket: device.webviews[0].socket, target: 'page' })).json(), { url: 'https://devtools.test/inspector' });
    assert.equal(opened, 1);
    inspector.close(); assert.equal(closed, 1);
    assert.equal((await post({ platform: 'android', id: 'phone', socket: device.webviews[0].socket, target: 'page' })).status, 409);
  } finally { inspector.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('concurrent requests share pending access and shutdown cleans up a late opening', async () => {
  let opened = 0; let released = 0; let finish!: (value: { url: string; close(): void }) => void;
  const inspector = routes.inspectorRoutes({ listDevices: async () => ({ devices: [device], warnings: [] }), openInspector: async () => { opened++; return new Promise(resolve => { finish = resolve; }); } });
  const app = express(); app.use(inspector.router);
  const server = createServer(app); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const post = () => fetch(`http://127.0.0.1:${address.port}/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ platform: 'android', id: device.id, socket: device.webviews[0].socket, target: 'page' }) });
  try {
    const responses = [post(), post()];
    await new Promise<void>(resolve => { const timer = setInterval(() => { if (opened) { clearInterval(timer); resolve(); } }, 1); });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(opened, 1);
    inspector.close(); finish({ url: 'https://devtools.test/', close: () => { released++; } });
    assert.deepEqual((await Promise.all(responses)).map(response => response.status), [409, 409]);
    assert.equal(released, 1);
  } finally { inspector.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('expired access is closed and replacement can be opened', async () => {
  let opened = 0; let released = 0;
  const inspector = routes.inspectorRoutes({ listDevices: async () => ({ devices: [device], warnings: [] }), openInspector: async () => { opened++; return { url: 'https://devtools.test/', close: () => { released++; } }; } }, 20);
  const app = express(); app.use(inspector.router);
  const server = createServer(app); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const post = () => fetch(`http://127.0.0.1:${address.port}/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ platform: 'android', id: device.id, socket: device.webviews[0].socket, target: 'page' }) });
  try {
    assert.equal((await post()).status, 200);
    await new Promise(resolve => setTimeout(resolve, 50)); assert.equal(released, 1);
    assert.equal((await post()).status, 200); assert.equal(opened, 2);
  } finally { inspector.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  assert.equal(released, 2);
});

test('failed openings release capacity and access is capped at eight targets', async () => {
  let fail = true; let released = 0;
  const views = Array.from({ length: 9 }, (_, index) => ({ ...device.webviews[0], id: `page-${index}` }));
  const inspector = routes.inspectorRoutes({ listDevices: async () => ({ devices: [{ ...device, webviews: views }], warnings: [] }), openInspector: async () => { if (fail) { fail = false; throw new Error('Device disappeared'); } return { url: 'https://devtools.test/', isActive: () => true, close: () => { released++; } }; } });
  const app = express(); app.use(inspector.router);
  const server = createServer(app); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const post = (index: number) => fetch(`http://127.0.0.1:${address.port}/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ platform: 'android', id: device.id, socket: device.webviews[0].socket, target: `page-${index}` }) });
  try {
    assert.equal((await post(0)).status, 409);
    for (let index = 0; index < 8; index++) assert.equal((await post(index)).status, 200);
    assert.equal((await post(8)).status, 429);
    inspector.close(); assert.equal(released, 8);
  } finally { inspector.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});


test('nine sequential inactive targets evict the oldest bridge without consuming active slots', async () => {
  let released = 0;
  const views = Array.from({ length: 9 }, (_, index) => ({ ...device.webviews[0], id: `page-${index}` }));
  const inspector = routes.inspectorRoutes({ listDevices: async () => ({ devices: [{ ...device, webviews: views }], warnings: [] }), openInspector: async () => ({ url: 'https://devtools.test/', isActive: () => false, close: () => { released++; } }) });
  const app = express(); app.use(inspector.router);
  const server = createServer(app); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  try {
    for (let index = 0; index < 9; index++) {
      const response: Response = await fetch(`http://127.0.0.1:${address.port}/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ platform: 'android', id: device.id, socket: device.webviews[0].socket, target: `page-${index}` }) });
      assert.equal(response.status, 200, `target ${index} should get a bridge`);
    }
    assert.equal(released, 1);
  } finally { inspector.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  assert.equal(released, 9);
});

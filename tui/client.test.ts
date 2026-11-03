import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

async function api() {
  const module = await import('./client.ts').catch(() => ({})) as Record<string, any>;
  assert.equal(typeof module.createTuiClient, 'function', 'TUI SSE client must exist');
  return module;
}
test('live client discovers sources, preserves metadata, and closes stopped streams without reconnect', async () => {
  const { createTuiClient } = await api();
  let connections = 0;
  const server = createServer((req, res) => {
    if (req.url === '/api/devices') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ devices: [{ id: 'phone', name: 'Phone', platform: 'android', state: 'connected', webviews: [{ id: 'page', socket: 'socket', title: 'Page', url: 'https://example.test' }] }], warnings: [] }));
    } else {
      connections++;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('event: logs\ndata: [{"timestamp":"2026-11-03T12:00:00Z","message":"original"}]\n\n');
      res.end('event: stopped\ndata: {"code":"connectionLost"}\n\n');
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const received: any[] = [];
  let stopped!: () => void;
  const done = new Promise<void>(resolve => { stopped = resolve; });
  const client = createTuiClient(`http://127.0.0.1:${address.port}`, {
    logs: (records: any[]) => received.push(...records),
    status: (message: { code?: string }, live: boolean) => { if (!live && message.code === 'connectionLost') stopped(); },
  });
  try {
    const sources = await client.sources();
    assert.equal(sources.length, 2);
    client.select(sources[1]);
    await Promise.race([done, new Promise((_, reject) => setTimeout(() => reject(new Error('SSE timeout')), 2000).unref())]);
    assert.equal(received[0].message, 'original');
    assert.equal(received[0].source.deviceId, 'phone');
    assert.equal(received[0].source.webview.id, 'page');
    assert.equal(connections, 1);
  } finally { client.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
test('live client rejects non-loopback and credential-bearing endpoints', async () => {
  const { createTuiClient } = await api();
  for (const url of ['https://example.com', 'http://user:pass@localhost:4310', 'file:///tmp/a']) {
    assert.throws(() => createTuiClient(url, { logs() {}, status() {} }));
  }
});

test('discovery warnings do not change an active capture into a stopped state', async () => {
  const { createTuiClient } = await api();
  const device = { id: 'phone', name: 'Phone', platform: 'android', state: 'connected' };
  const server = createServer((req, res) => {
    if (req.url === '/api/devices') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ devices: [device], warnings: ['discovery warning'] }));
    } else {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('event: status\ndata: {"code":"streamLive"}\n\n');
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  let ready!: () => void;
  const live = new Promise<void>(resolve => { ready = resolve; });
  let reportedLive = false;
  const client = createTuiClient(`http://127.0.0.1:${(server.address() as {port: number}).port}`, {
    logs() {}, status(_message: unknown, active: boolean) { reportedLive = active; if (active) ready(); },
  });
  try {
    client.select(device);
    await Promise.race([live, new Promise((_, reject) => setTimeout(() => reject(new Error('SSE timeout')), 2000).unref())]);
    await client.sources();
    assert.equal(reportedLive, true);
  } finally { client.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

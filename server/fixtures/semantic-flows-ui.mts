/** Synthetic browser fixture; no hardware. Run after build with node --import tsx. */
import express from 'express';
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlowProject } from '../flow-project.js';

export async function createSemanticFlowsFixture(autoReplay = true) {
  const repository = fileURLToPath(new URL('../../', import.meta.url));
  const root = await mkdtemp(join(tmpdir(), 'semantic-flows-ui-'));
  const projectDirectory = join(root, 'test_flow_project');
  await cp(join(repository, 'test_flow_project'), projectDirectory, { recursive: true });
  // Only this temporary copy has short deadlines, so browser timeout checks finish quickly.
  for (const filename of await readdir(join(projectDirectory, '.udl/flows'))) {
    if (!/\.ya?ml$/.test(filename)) continue;
    const file = join(projectDirectory, '.udl/flows', filename);
    await writeFile(file, (await readFile(file, 'utf8')).replace(/^timeout: .+$/m, 'timeout: 3s'));
  }
  const project = await FlowProject.create(projectDirectory);
  const device = { id: 'semantic-phone', platform: 'ios', name: 'iPhone Semantic Fixture', state: 'connected', webviews: [{ id: 'checkout', socket: 'fixture-webview', title: 'Shop WebView', url: 'https://example.test/checkout' }] };
  const app = express();
  const clients = new Map<express.Response, boolean>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let serial = 0, autoStarted = false;
  const schedule = (fn: () => void, delay: number) => { const timer = setTimeout(() => { timers.delete(timer); fn(); }, delay); timers.add(timer); };
  function replay() {
    const run = ++serial;
    const a = `purchase-a-${run}`, b = `purchase-b-${run}`;
    const events: [boolean, Record<string, unknown>][] = [
      [false, { event: 'purchase.init', attemptId: a }],
      [false, { event: 'purchase.init', attemptId: b }],
      [false, { event: 'purchase.ready', attemptId: a, uid: a }],
      [false, { event: 'purchase.ready', attemptId: b, uid: b }],
      [false, { event: 'store.ios.start', uid: a }],
      [false, { event: 'store.android.start', uid: b }],
      [false, { event: 'store.receipt', uid: b, receipt: 'SECRET-RECEIPT-B', payload: { transactionId: `transaction-b-${run}`, productId: 'coins.large' } }],
      [false, { event: 'store.receipt', uid: a, receipt: 'SECRET-RECEIPT-A', payload: { transactionId: `transaction-a-${run}`, productId: 'coins.small' } }],
      [true, { event: 'purchase.submit', transaction_id: `transaction-a-${run}` }],
      [true, { event: 'purchase.submit', transaction_id: `transaction-b-${run}` }],
      [true, { event: 'purchase.confirmed', uid: b }],
      [true, { event: 'purchase.confirmed', uid: a }],
      [true, { event: 'balance.updated', purchaseUid: a, balance: 1250 }],
      [true, { event: 'balance.updated', purchaseUid: b, balance: 1750 }],
      [false, { event: 'login.start', requestId: `login-${run}` }],
      [true, { event: 'login.success', requestId: `login-${run}`, userId: 'fixture-user' }],
      [false, { event: 'asset.start', downloadId: `asset-${run}`, url: 'https://example.test/demo.zip' }],
      [false, { event: 'asset.received', downloadId: `asset-${run}`, bytes: 1024 }],
      [false, { event: 'asset.error', downloadId: `asset-${run}`, code: 'CHECKSUM_MISMATCH', stack: 'Error: checksum mismatch\n    at verifyAsset (fixture.js:42:7)' }],
      [true, { event: 'login.success', requestId: `orphan-${run}`, userId: 'fixture-user' }],
      [false, { event: 'purchase.init', attemptId: `timeout-${run}` }],
    ];
    events.forEach(([webview, body], index) => schedule(() => {
      const record = { timestamp: new Date().toISOString(), message: JSON.stringify(body), level: body.event === 'asset.error' ? 'ERROR' : 'INFO', tag: webview ? 'console.log' : 'SemanticFixture' };
      for (const [client, target] of clients) if (target === webview) client.write(`event: logs\ndata: ${JSON.stringify([record])}\n\n`);
    }, index * 35));
    return run;
  }
  app.get('/api/devices', (_request, response) => response.json({ devices: [device], warnings: [] }));
  app.use('/api/flows', project.router());
  app.get('/api/logs', (request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    const webview = !!request.query.webviewId;
    clients.set(response, webview);
    response.write(`event: status\ndata: ${JSON.stringify({ code: webview ? 'webviewLive' : 'streamLive', params: {} })}\n\n`);
    const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 1000);
    response.once('close', () => { clearInterval(heartbeat); clients.delete(response); });
    if (autoReplay && !autoStarted && [...clients.values()].includes(true) && [...clients.values()].includes(false)) { autoStarted = true; schedule(replay, 300); }
  });
  app.get('/fixture/state', (_request, response) => response.json({ native: [...clients.values()].filter(value => !value).length, webview: [...clients.values()].filter(Boolean).length, runs: serial }));
  app.post('/fixture/replay', (_request, response) => response.json({ run: replay() }));
  app.use(express.static(resolve(process.env.SEMANTIC_FLOWS_DIST ?? join(repository, 'dist'))));
  return { app, projectDirectory, close: async () => { for (const timer of timers) clearTimeout(timer); for (const response of clients.keys()) response.end(); await rm(root, { recursive: true, force: true }); } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const fixture = await createSemanticFlowsFixture();
  const server = fixture.app.listen(Number(process.env.SEMANTIC_FLOWS_PORT ?? 4313), '127.0.0.1', () => console.log('Semantic Flows UI fixture: http://127.0.0.1:4313 (select native + Shop WebView; sample project is copied to temporary storage)'));
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { server.close(); void fixture.close().then(() => process.exit(0)); });
}

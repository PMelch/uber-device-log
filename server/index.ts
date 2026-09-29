import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { listDevices, openLogs, type Stop } from './devices';
import { streamLogs } from './stream';

const root = fileURLToPath(new URL('..', import.meta.url));
const app = express();
const server = createServer(app);
const port = Number(process.env.PORT || 4310);
const active = new Set<Stop>();

// Local development utility: neither discovery nor logs are exposed to the LAN.
app.use((request, response, next) => {
  const allowed = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
  const origin = request.headers.origin;
  if (!allowed.has(request.headers.host || '') || (origin && ![`http://localhost:${port}`, `http://127.0.0.1:${port}`].includes(origin))) {
    response.sendStatus(403);
    return;
  }
  next();
});

app.get('/api/devices', async (_request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.json(await listDevices());
});

app.get('/api/logs', async (request, response) => {
  const { platform, id } = request.query;
  if ((platform !== 'android' && platform !== 'ios') || typeof id !== 'string' || !id) {
    response.status(400).json({ error: 'A platform and device ID are required.' });
    return;
  }
  const { devices } = await listDevices();
  if (response.destroyed) return;
  const device = devices.find(item => item.platform === platform && item.id === id);
  if (!device || device.state !== 'connected') {
    response.status(409).json({ error: 'Device is disconnected or unauthorized. Refresh the device list.' });
    return;
  }
  const stop = streamLogs(response, device, openLogs);
  active.add(stop);
  response.once('close', () => active.delete(stop));
});

app.use('/api', (_request, response) => { response.sendStatus(404); });

let closeVite: (() => Promise<void>) | undefined;
if (process.argv.includes('--production')) {
  app.use(express.static(`${root}/dist`));
} else {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    root,
    server: { middlewareMode: true, hmr: { server }, allowedHosts: ['localhost', '127.0.0.1'] },
    appType: 'spa',
  });
  app.use(vite.middlewares);
  closeVite = () => vite.close();
}

server.once('error', async (error: NodeJS.ErrnoException) => {
  console.error(error.code === 'EADDRINUSE'
    ? `Port ${port} is already in use. Stop the existing server or run with a different port: PORT=${port + 1} bun run dev`
    : `Unable to start device logs: ${error.message}`);
  process.exitCode = 1;
  await shutdown();
});
server.listen(port, '127.0.0.1', () => console.log(`Device logs: http://127.0.0.1:${port}`));
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const stop of active) stop();
  await closeVite?.();
  server.close();
  server.closeAllConnections();
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

import { notification } from '../shared/notifications.js';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { acquireWebView, listDevices } from './devices.js';
import { ConsoleError } from './runtime-console.js';

export function consoleRoutes(dependencies = { acquireWebView, listDevices }) {
  let opening = 0;
  const router = express.Router();
  const sessions = new Map<string, Awaited<ReturnType<typeof acquireWebView>> & { touched: number }>();
  const remove = (id: string) => { sessions.get(id)?.release(); sessions.delete(id); };
  const timer = setInterval(() => { for (const [id, s] of sessions) if (Date.now() - s.touched > 120_000) remove(id); }, 30_000);
  timer.unref();
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  router.use((req, res, next) => {
    if (req.method === 'POST' && !req.is('application/json')) { res.status(415).json(notification('consoleInvalid')); return; }
    next();
  });
  router.use(express.json({ limit: '100kb' }));
  router.post('/', async (req, res) => {
    if (sessions.size + opening >= 8) { res.status(429).json(notification('consoleBusy')); return; }
    opening++;
    try {
      const { platform, id, socket, target } = req.body ?? {};
      const device = (await dependencies.listDevices()).devices.find(d => d.platform === platform && d.id === id && d.state === 'connected');
      const webview = device?.webviews?.find(v => v.id === target && v.socket === socket);
      if (!device || !webview) throw new ConsoleError('consoleUnavailable');
      const session = await dependencies.acquireWebView({ ...device, webview });
      if (res.destroyed) { session.release(); return; }
      const token = randomUUID();
      sessions.set(token, { ...session, touched: Date.now() });
      // Context enumeration can continue while the panel displays its connecting state.
      void session.runtime.enable();
      res.json({ id: token, ...session.runtime.state() });
    } catch { res.status(409).json(notification('consoleUnavailable')); }
    finally { opening--; }
  });
  router.get('/:id', (req, res) => {
    const s = sessions.get(req.params.id);
    if (!s) { res.status(409).json(notification('consoleUnavailable')); return; }
    s.touched = Date.now(); res.json(s.runtime.state());
  });
  router.post('/:id/execute', async (req, res) => {
    const s = sessions.get(req.params.id);
    if (!s) { res.status(409).json(notification('consoleUnavailable')); return; }
    s.touched = Date.now();
    try { res.json(await s.runtime.evaluate(req.body?.context, req.body?.revision, req.body?.expression)); }
    catch (error) { res.status(409).json(notification(error instanceof ConsoleError ? error.code : 'consoleUnavailable')); }
  });
  router.delete('/:id', (req, res) => { remove(req.params.id); res.sendStatus(204); });
  router.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(400).json(notification('consoleInvalid')); });
  return { router, close: () => { clearInterval(timer); for (const id of sessions.keys()) remove(id); } };
}

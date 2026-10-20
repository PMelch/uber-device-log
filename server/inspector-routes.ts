import express from 'express';
import type { Device } from '../shared/types.js';
import { listDevices, openInspector } from './devices.js';
import { notification } from '../shared/notifications.js';

interface InspectorAccess { url: string; close(): void; isActive?(): boolean }
export function inspectorRoutes(dependencies: { listDevices: typeof listDevices; openInspector(device: Device): Promise<InspectorAccess> } = { listDevices, openInspector }, lifetime = 30 * 60_000) {
  const router = express.Router();
  const sessions = new Map<string, InspectorAccess & { expires: number }>();
  const opening = new Map<string, Promise<InspectorAccess>>();
  let closed = false;
  const remove = (key: string) => { sessions.get(key)?.close(); sessions.delete(key); };
  const timer = setInterval(() => { for (const [key, session] of sessions) if (Date.now() >= session.expires) remove(key); }, Math.min(lifetime, 30_000));
  timer.unref();
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  router.use((req, res, next) => { if (req.method === 'POST' && !req.is('application/json')) { res.status(415).json(notification('inspectorInvalid')); return; } next(); });
  router.use(express.json({ limit: '10kb' }));
  router.post('/', async (req, res) => {
    try {
      if (closed) throw new Error('Inspector closed');
      const { platform, id, socket, target } = req.body ?? {};
      if (platform !== 'android' || ![id, socket, target].every(value => typeof value === 'string' && value.length > 0 && value.length < 1024)) throw new Error('Invalid target');
      const device = (await dependencies.listDevices()).devices.find(item => item.platform === platform && item.id === id && item.state === 'connected');
      const webview = device?.webviews?.find(item => item.socket === socket && item.id === target);
      if (closed || !device || !webview) throw new Error('Target unavailable');
      const key = JSON.stringify([platform, id, socket, target]);
      const old = sessions.get(key);
      if (old && Date.now() >= old.expires) remove(key);
      if (!sessions.has(key) && !opening.has(key)) {
        if (sessions.size + opening.size >= 8) {
          // Map order follows creation time. A closed (or unopened) frontend can be
          // replaced immediately; active inspectors and pending opens retain slots.
          const inactive = [...sessions].find(([, session]) => !session.isActive?.());
          if (inactive) remove(inactive[0]);
          else { res.status(429).json(notification('inspectorBusy')); return; }
        }
        const pending = dependencies.openInspector({ ...device, webview }).then(session => {
          if (closed) { session.close(); throw new Error('Inspector closed'); }
          sessions.set(key, { ...session, expires: Date.now() + lifetime });
          return session;
        }).finally(() => opening.delete(key));
        opening.set(key, pending);
      }
      const session = sessions.get(key) ?? await opening.get(key);
      if (!session || closed) throw new Error('Inspector unavailable');
      res.json({ url: session.url });
    } catch { res.status(409).json(notification('inspectorUnavailable')); }
  });
  router.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(400).json(notification('inspectorInvalid')); });
  return { router, close() { if (closed) return; closed = true; clearInterval(timer); for (const key of sessions.keys()) remove(key); } };
}

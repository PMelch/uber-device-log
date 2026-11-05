import express from 'express';
import { androidDevices, listAndroidProcesses } from './devices.js';
import { notification } from '../shared/notifications.js';

export function processRoutes(deps = { androidDevices, listAndroidProcesses }) {
  const router = express.Router();
  router.get('/', async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    const { id } = request.query;
    if (typeof id !== 'string' || !id || id.length > 1024) {
      response.status(400).json(notification('processUnavailable')); return;
    }
    try {
      const device = (await deps.androidDevices()).find(device => device.id === id && device.platform === 'android' && device.state === 'connected');
      if (!device) { response.status(409).json(notification('processUnavailable')); return; }
      response.json({ processes: await deps.listAndroidProcesses(device.id) });
    } catch { response.status(503).json(notification('processUnavailable')); }
  });
  return router;
}

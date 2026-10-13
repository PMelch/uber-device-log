/** Local visual QA fixture. Run after build: node --import tsx server/fixtures/webview-ui.mts */
import express from 'express';
import { fileURLToPath } from 'node:url';
const app = express();
const device = { id: 'prototype-phone', platform: 'android', name: 'Pixel Prototype', state: 'connected', webviews: [
  { id: 'checkout', socket: 'webview_devtools_remote_42', title: 'Checkout · Zahlungsbestätigung und Versandinformationen', url: 'https://example.test/checkout', pid: 42 },
  { id: 'support', socket: 'webview_devtools_remote_42', title: 'Support', url: 'https://example.test/support', pid: 42 },
] };
let removed = false;
app.get('/api/devices', (_req, res) => res.json({ devices: [{ ...device, webviews: removed ? [] : device.webviews }], warnings: [] }));
app.post('/fixture/remove', (_req, res) => { removed = true; res.sendStatus(204); });
app.get('/api/logs', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const webview = req.query.webviewId;
  res.write(`event: status\ndata: ${JSON.stringify({ code: webview ? 'webviewLive' : 'streamLive', params: {} })}\n\n`);
  res.write(`event: logs\ndata: ${JSON.stringify([{ timestamp: new Date().toISOString(), level: 'I', tag: webview ? 'console.log' : 'ActivityManager', pid: 42, message: webview ? `WebView ${webview}: hello from JavaScript` : 'Phone Logcat: activity resumed' }, ...(webview ? [{ timestamp: new Date().toISOString(), level: 'E', tag: 'console.exception', pid: 42, message: 'TypeError: prototype error\n    at checkout.js:12:4' }] : [])])}\n\n`);
  const timer = setInterval(() => res.write(': heartbeat\n\n'), 1000);
  res.once('close', () => clearInterval(timer));
});
app.use(express.static(fileURLToPath(new URL('../../dist', import.meta.url))));
app.listen(4312, '127.0.0.1', () => console.log('WebView UI fixture: http://127.0.0.1:4312'));

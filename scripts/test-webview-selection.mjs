// Synthetic browser regression for the fixed toolbar and overlay workflows.
// Build first. PLAYWRIGHT_MODULE / CHROME_EXECUTABLE match test-log-performance.mjs.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const clients = new Set();
let next = 0;
function deliver(response, count) {
  response.write(`event: logs\ndata: ${JSON.stringify(Array.from({ length: count }, () => {
    const id = next++;
    return { timestamp: new Date(1760000000000 + id).toISOString(), level: id % 3 === 0 ? 'E' : 'I', tag: 'Checkout', pid: 42,
      message: `Record ${id}: checkout request\n    at example.Checkout.run(Checkout.java:42)` };
  }))}\n\n`);
}
const server = createServer(async (request, response) => {
  if (request.url === '/api/devices') {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ devices: [{ id: 'fixture', name: 'Pixel fixture', platform: 'android', state: 'connected', webviews: [
      { id: 'page-a', socket: 'socket', title: 'Customer portal with a deliberately long title', url: 'https://app.example.com/account?token=secret#private' },
      { id: 'page-b', socket: 'socket', title: 'Customer portal with a deliberately long title', url: 'https://app.example.com/checkout' },
      { id: 'page-c', socket: 'socket', title: '', url: 'https://login.example.com/signin?long=hidden' }
    ] }], warnings: [] })); return;
  }
  if (request.url.startsWith('/api/logs?')) {
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    response.write('event: status\ndata: {"code":"streamLive","params":{}}\n\n');
    clients.add(response); deliver(response, 80);
    request.on('close', () => clients.delete(response)); return;
  }
  try {
    const path = resolve(root, '.' + (request.url === '/' ? '/index.html' : request.url.split('?')[0]));
    if (!path.startsWith(root + '/') && path !== root) throw Error('Invalid path');
    response.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : path.endsWith('.svg') ? 'image/svg+xml' : 'text/html');
    response.end(await readFile(path));
  } catch { response.writeHead(404); response.end(); }
});
let browser;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE });
  const errors = [];
  for (const [width, locale] of [1440, 390, 320].flatMap(width => ['en','de','es','fr','it','ja','zh-CN'].map(locale => [width,locale]))) {
    const page = await browser.newPage({ viewport: {width, height: 1000}, hasTouch: width < 700 });
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(locale => localStorage.setItem('uber-device-log.language', locale), locale);
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const mobile = width < 700;
    if (mobile) await page.locator('.precision-device summary').click();
    const container = page.locator(mobile ? '.precision-device .precision-menu' : '.device-sidebar-list');
    const row = container.locator('.webview-option').first();
    await row.waitFor();
    assert.equal(await row.locator('.precision-sub').innerText(), 'app.example.com · /account');
    assert.ok(!(await row.locator('.webview-select').innerText()).includes('secret'));
    const before = await row.boundingBox();
    const info = row.locator('.overlay-trigger');
    await info.focus(); await page.keyboard.press('Enter');
    const panel = page.locator('.webview-details:popover-open');
    await panel.waitFor();
    assert.equal(await panel.locator('input').inputValue(), 'https://app.example.com/account?token=secret#private');
    await panel.locator('input').focus();
    await page.keyboard.press('ArrowLeft');
    assert.equal(await panel.locator('input').evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Escape');
    assert.equal(await info.evaluate(el => el === document.activeElement), true);
    assert.deepEqual(await row.boundingBox(), before);
    if (mobile) assert.equal(await page.locator('.precision-device details').evaluate(el => el.open), true);
    await row.locator('.webview-select').click();
    if (mobile) await page.locator('.precision-device summary').click();
    assert.equal(await row.locator('.webview-select').getAttribute('aria-pressed'), 'true');
    await info.focus(); await page.keyboard.press('Enter');
    await panel.waitFor();
    await panel.evaluate(async el => { await Promise.all(el.getAnimations().map(animation => animation.finished)); });
    await page.screenshot({path: `/tmp/webview-selection-${width}-${locale}.png`});
    await page.close();
    console.log(`WebView selection and details: ${width}px ${locale} passed`);
  }
  assert.deepEqual(errors, []);
} finally { await browser?.close(); for (const client of clients) client.end(); server.close(); }

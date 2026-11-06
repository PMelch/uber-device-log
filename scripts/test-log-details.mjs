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
let platform = 'android';
function deliver(response, count) {
  response.write(`event: logs\ndata: ${JSON.stringify(Array.from({ length: count }, () => {
    const id = next++;
    return { timestamp: new Date(1760000000000 + id).toISOString(), level: id % 3 === 0 ? 'E' : 'I', tag: 'Checkout', pid: 42,
      message: platform === 'ios' ? `Nov  6 08:00:00 iPhone Checkout[42] <Notice>: Record ${id}: checkout request` : `Record ${id}: checkout request\n    at example.Checkout.run(Checkout.java:42)` };
  }))}\n\n`);
}
const server = createServer(async (request, response) => {
  if (request.url === '/api/devices') {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ devices: [{ id: 'fixture', name: 'Phone fixture', platform, state: 'connected' }], warnings: [] })); return;
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
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? {executablePath: process.env.CHROME_EXECUTABLE} : {}) });
  for (platform of ['ios', 'android']) for (const order of ['bottom', 'top']) for (const touch of [false, true]) {
    const page = await browser.newPage({ viewport: {width: touch ? 390 : 1440, height: 1000}, hasTouch: touch });
    await page.addInitScript(({ platform, order }) => {
      localStorage.setItem('uber-device-log.lastDevice', `${platform}:fixture`);
      localStorage.setItem('uber-device-log.messageOrder', order);
      localStorage.setItem('uber-device-log.language', 'en');
    }, { platform, order });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const trigger = order === 'bottom' ? page.locator('.precision-detail-trigger').last() : page.locator('.precision-detail-trigger').first();
    const panel = page.locator('#log-message-details');
    await trigger.waitFor();
    if (!touch) {
      await trigger.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300); // Let initial virtualizer scrolling settle.
      await page.mouse.move(0, 0);
      await trigger.hover();
      await panel.waitFor(); // Real hover preview before clicking, not an instantaneous click.
    }
    if (touch) await trigger.tap(); else await trigger.click();
    await page.waitForTimeout(500); // Exceed the preview dismissal timer.
    assert.equal(await panel.isVisible(), true, 'Click must pin an existing preview');
    assert.equal(await panel.locator('.log-detail-state').innerText(), 'Pinned');
    const snapshot = await panel.innerText();
    const originalTrigger = await trigger.elementHandle();
    const originalKey = await trigger.evaluate(el => el.closest('[data-log-key]').dataset.logKey);
    await page.evaluate(() => { window.detailScrolls = 0; document.querySelector('.logs').addEventListener('scroll', () => window.detailScrolls++); });
    for (let batch = 0; batch < 5; batch++) {
      for (const client of clients) deliver(client, 30);
      await page.waitForTimeout(120);
    }
    console.log({ platform, order, touch, scrolls: await page.evaluate(() => window.detailScrolls), originalConnected: await originalTrigger.evaluate(el => el.isConnected), visible: await panel.isVisible() });
    assert.equal(await panel.isVisible(), true, 'Live capture must preserve pinned details');
    assert.equal(await panel.innerText(), snapshot, 'Streaming must not replace the pinned snapshot');
    await page.keyboard.press('Escape');
    assert.equal(await panel.count(), 0);
    assert.equal(await page.evaluate(key => document.activeElement === (document.querySelector(`[data-log-key="${key}"] .precision-detail-trigger`) ?? document.querySelector('.logs')), originalKey), true);
    if (!touch) {
      await page.locator('.logs').focus();
      await trigger.focus();
      await panel.waitFor();
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
      assert.equal(await panel.isVisible(), true, 'Keyboard activation must pin the focus preview');
      await page.keyboard.press('Escape');
    }
    if (touch) await trigger.tap(); else await trigger.click();
    await panel.waitFor();
    await page.waitForTimeout(500); // Separate taps from the browser's double-tap gesture.
    // On narrow screens the pinned panel may cover the original trigger.
    if (touch) await panel.locator('.log-detail-close').tap(); else await trigger.click();
    await panel.waitFor({state: 'detached'});
    assert.equal(await panel.count(), 0, 'Second activation closes pinned details');
    if (touch) await trigger.tap(); else await trigger.click();
    await panel.waitFor();
    await page.locator('.logs').dispatchEvent(touch ? 'touchmove' : 'wheel');
    await panel.waitFor({ state: 'detached' });
    if (touch) await trigger.tap(); else await trigger.click();
    await panel.waitFor();
    await page.locator('.precision-time').last().dispatchEvent('pointerdown');
    await panel.waitFor({ state: 'detached' });
    await page.close();
    console.log(`${platform}/${order}: ${touch ? 'Touch' : 'Mouse and keyboard'} log details passed`);
  }
} finally { await browser?.close(); for (const client of clients) client.end(); server.close(); }

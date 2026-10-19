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
    response.end(JSON.stringify({ devices: [{ id: 'fixture', name: 'Pixel fixture', platform: 'android', state: 'connected' }], warnings: [] })); return;
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
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
  page.setDefaultTimeout(8000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('uber-device-log.lastDevice', 'android:fixture');
    localStorage.setItem('uber-device-log.bufferSize', '1000');
    localStorage.setItem('uber-device-log.language', 'en');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => {
      if (window.rejectCopy) throw Error('Clipboard denied by fixture');
      window.copiedText = text;
    } } });
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const openActions = async () => { await page.locator('.precision-commandbar > .overlay-trigger').click(); };
  const overlay = () => page.locator('.precision-overlay:popover-open');
  const geometry = () => page.evaluate(() => ({
    viewport: document.querySelector('.logs').getBoundingClientRect().top,
    rows: [...document.querySelectorAll('.entry')].map(row => [row.dataset.logKey, row.getBoundingClientRect().top]),
  }));
  const unchanged = async (before, label) => {
    const after = await geometry();
    assert.ok(Math.abs(before.viewport - after.viewport) < .1, `${label}: viewport moved`);
    for (const [key, top] of before.rows) {
      const row = after.rows.find(([id]) => id === key);
      assert.ok(row && Math.abs(row[1] - top) < .1, `${label}: row ${key} moved`);
    }
  };
  for (const width of [1440, 900, 390, 320]) {
    await page.setViewportSize({ width, height: 1100 });
    await page.goto(url);
    await page.waitForSelector('.entry'); await page.waitForTimeout(250);
    const baseline = await geometry();
    const sourceHeight = await page.locator('.source-filters').evaluate(el => el.getBoundingClientRect().height);
    await page.locator('.source-filters .overlay-trigger').click();
    await page.waitForTimeout(200);
    await unchanged(baseline, `${width}: open filters`);
    await overlay().locator('.source-advanced summary').click();
    await unchanged(baseline, `${width}: advanced filters`);
    await overlay().locator('input[inputmode=numeric]').fill('invalid');
    assert.equal(await page.locator('.entry').count(), 0);
    assert.equal(await overlay().locator('[aria-invalid=true]').count(), 1);
    await overlay().locator('input[type=search]').fill('A deliberately very long search query with spaces and punctuation');
    await overlay().locator('input[id$="-tag"]').fill('LongAndroidTagForSummary');
    await overlay().locator('.source-levels button').last().click();
    assert.equal(await page.locator('.source-filter-chip').count(), 4);
    assert.match(await page.locator('.source-filter-summary').getAttribute('aria-label'), /invalid/);
    assert.equal(await page.locator('.source-filters').evaluate(el => el.getBoundingClientRect().height), sourceHeight);
    const sourceFits = await page.locator('.source-filter-main').evaluate(el => {
      const row = el.getBoundingClientRect(), button = el.querySelector('.overlay-trigger').getBoundingClientRect();
      return el.scrollWidth <= el.clientWidth && button.right <= row.right + 1 && button.height <= row.height;
    });
    assert.equal(sourceFits, true, `${width}: inline summaries preserve row and button bounds`);
    if (process.env.WORKFLOW_SCREENSHOT) await page.locator('.source-filters').screenshot({path: process.env.WORKFLOW_SCREENSHOT.replace(/\.png$/, `-summary-${width}.png`)});
    await overlay().getByRole('button', { name: 'Reset filters', exact: true }).click();
    await page.waitForSelector('.entry');
    assert.equal(await page.locator('.source-filter-summary').innerText(), 'Levels: All');
    await page.keyboard.press('Escape');
    assert.equal(await overlay().count(), 0);
    assert.equal(await page.locator('.source-filters .overlay-trigger').evaluate(el => el === document.activeElement), true);
    assert.equal(await page.locator('.command-select').isVisible(), false, 'mouse users select directly, even at narrow widths');
    await page.locator('.entry input').first().focus();
    await page.keyboard.press('Space');
    await unchanged(baseline, `${width}: keyboard selection`);
    await unchanged(baseline, `${width}: check row`);
    await page.locator('.precision-commandbar .command-primary').click();
    assert.match(await page.evaluate(() => window.copiedText), /Checkout.run/);
    await unchanged(baseline, `${width}: copy feedback`);
    await openActions(); await unchanged(baseline, `${width}: actions overlay`);
    if (process.env.WORKFLOW_SCREENSHOT) await page.screenshot({ path: process.env.WORKFLOW_SCREENSHOT.replace(/\.png$/, `-menu-${width}.png`), fullPage: true, animations: 'disabled' });
    await overlay().locator('.command-help summary').click();
    await unchanged(baseline, `${width}: expanded menu help`);
    await overlay().locator('.command-help summary').click();
    await overlay().getByRole('button', { name: 'Range to…', exact: true }).click();
    await page.locator('.entry input').nth(2).click();
    assert.equal(await page.locator('.entry input:checked').count(), 3, 'range includes both endpoints');
    assert.equal(await page.locator('.command-primary').innerText(), 'Copy', 'selection changes clear stale copy confirmation');
    await openActions();
    await overlay().getByRole('button', { name: 'Select all filtered', exact: true }).click();
    await openActions();
    await overlay().locator('#command-export-format').selectOption('json');
    const downloadEvent = page.waitForEvent('download');
    await overlay().getByRole('button', { name: 'Save (80)', exact: true }).click();
    const downloaded = await downloadEvent;
    const exported = JSON.parse(await readFile(await downloaded.path(), 'utf8'));
    assert.equal(exported.entries.length, 80, 'export includes offscreen selection');
    assert.match(exported.entries[0].message, /Checkout.run/);
    await page.evaluate(() => { window.rejectCopy = true; });
    await page.locator('.precision-commandbar .command-primary').click();
    assert.equal(await page.locator('dialog[open]').count(), 1);
    await unchanged(baseline, `${width}: clipboard fallback`);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('dialog[open]').count(), 0);
    await openActions();
    await overlay().getByRole('button', { name: 'Done selecting', exact: true }).click();
    await unchanged(baseline, `${width}: finish selection`);
    assert.equal(await page.locator('.logs').evaluate(el => el === document.activeElement), true, 'desktop focus returns to the list, not the hidden Select button');
    for (const client of clients) deliver(client, 1200);
    await page.waitForFunction(() => document.querySelector('.command-context').textContent.includes('1,200'));
    await unchanged(baseline, `${width}: paused arrivals beyond retention`);
    await page.getByRole('button', { name: 'Back to live', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.command-context').textContent.includes('1,000'));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}: horizontal overflow`);
    console.log(`${width}px: fixed rows, filters, selection, export, copy fallback, pause and retention passed`);
  }
  // Long translations, language switching with a retained selection and status.
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 1100 });
    await page.goto(url); await page.waitForSelector('.entry'); await page.waitForTimeout(200);
    await page.locator('.entry input').first().click();
    await page.locator('.precision-commandbar .command-primary').click();
    const sourceHeight = await page.locator('.source-filters').evaluate(el => el.getBoundingClientRect().height);
    for (const locale of ['de', 'fr', 'it', 'es', 'ja', 'zh-CN', 'en']) {
      await page.locator('.precision-settings summary').click();
      await page.locator('#settings-language').selectOption(locale);
      await page.locator('.settings-panel header button').click();
      // Translated device/setup text may wrap differently; measure interaction
      // stability within each language, not the page height across languages.
      const localized = await geometry();
      assert.equal(await page.locator('.entry input:checked').count(), 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const clips = await page.locator('.precision-commandbar button, .command-context, .precision-consolebar').evaluateAll(els => els.filter(el => el.clientHeight && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1)).map(el => el.textContent));
      assert.deepEqual(clips, [], `${locale}: clipped toolbar labels`);
      await page.locator('.source-filters .overlay-trigger').click();
      await overlay().locator('input[type=search]').fill('Record');
      await page.waitForTimeout(200); // Allow ResizeObserver to clamp the resized popover.
      assert.equal(await page.locator('.source-filter-chip').count(), 2);
      assert.equal(await page.locator('.source-filters').evaluate(el => el.getBoundingClientRect().height), sourceHeight);
      assert.ok((await page.locator('.source-filter-summary').getAttribute('aria-label')).includes('Record'));
      assert.equal(await overlay().evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; }), true);
      await page.keyboard.press('Escape');
      await unchanged(localized, `${width}: localized filter ${locale}`);
      await openActions();
      await unchanged(localized, `${width}: localized actions ${locale}`);
      if (locale === 'de' && process.env.WORKFLOW_SCREENSHOT) await overlay().screenshot({ path: process.env.WORKFLOW_SCREENSHOT.replace(/\.png$/, `-de-${width}.png`), animations: 'disabled' });
      await page.keyboard.press('Escape');
    }
  }
  const touch = await browser.newPage({ viewport: { width: 390, height: 1000 }, hasTouch: true });
  await touch.addInitScript(() => {
    localStorage.setItem('uber-device-log.lastDevice', 'android:fixture');
    localStorage.setItem('uber-device-log.language', 'en');
  });
  for (const width of [390, 1440]) {
    await touch.setViewportSize({ width, height: 1000 });
    await touch.goto(url); await touch.waitForSelector('.entry');
    assert.equal(await touch.locator('.command-select').isVisible(), true, 'touch affordance must not depend on viewport width');
    await touch.getByRole('button', { name: 'Select', exact: true }).tap();
    assert.equal(await touch.locator('.entry input').first().isVisible(), true);
    await touch.locator('.entry input').first().tap();
    assert.equal(await touch.locator('.entry input:checked').count(), 1);
    await touch.locator('.precision-commandbar > .overlay-trigger').tap();
    await touch.getByRole('button', { name: 'Done selecting', exact: true }).tap();
    assert.equal(await touch.locator('.command-select').evaluate(el => el === document.activeElement), true);
  }
  await touch.close();
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  await page.locator('.source-filters .overlay-trigger').click();
  assert.equal(await overlay().evaluate(el => getComputedStyle(el).animationName), 'none');
  if (process.env.WORKFLOW_SCREENSHOT) await page.screenshot({ path: process.env.WORKFLOW_SCREENSHOT, fullPage: true });
  assert.deepEqual(errors, []);
  console.log('All seven languages, retained selection, reduced motion and browser errors passed.');
} finally {
  await browser?.close();
  for (const response of clients) response.end();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}

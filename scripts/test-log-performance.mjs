// Browser regression with synthetic logs; no connected device is needed.
// Requires a debug build for diagnostics, or PERFORMANCE_RELEASE_CHECK=true for a release build.
// See docs/log-performance.md for Playwright and build commands.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const releaseCheck = process.env.PERFORMANCE_RELEASE_CHECK === 'true';
const root = resolve(process.env.PERFORMANCE_DIST || fileURLToPath(new URL('../dist/', import.meta.url)));
const clients = new Set();
let streaming = false, nextKey = 0;
function record() {
  const key = nextKey++;
  return { timestamp: new Date(1760000000000 + key).toISOString(),
    message: key % 37 === 0 ? `RuntimeException: record ${key}\n    at example.Work.run(Work.java:42)\n    at example.Main.main(Main.java:12)`
      : `record ${key} ${key % 17 === 0 ? 'wrapped diagnostic '.repeat(18) : 'connection active'}`,
    level: key % 7 === 0 ? 'E' : 'I', tag: 'App', pid: 42 };
}
function deliver(response, count) {
  response.write(`event: logs\ndata: ${JSON.stringify(Array.from({ length: count }, record))}\n\n`);
}
const server = createServer(async (request, response) => {
  if (request.url === '/api/devices') {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ devices: [{ id: 'fixture', name: 'Performance fixture', platform: 'android', state: 'connected' }], warnings: [] }));
    return;
  }
  if (request.url.startsWith('/api/logs?')) {
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    response.write('event: status\ndata: {"code":"sourcesLive","params":{"count":1}}\n\n');
    clients.add(response); deliver(response, 10000);
    request.on('close', () => clients.delete(response));
    return;
  }
  try {
    const path = resolve(root, '.' + (request.url === '/' ? '/index.html' : request.url.split('?')[0]));
    if (!path.startsWith(root)) throw new Error('Invalid fixture path');
    const body = await readFile(path);
    response.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : path.endsWith('.svg') ? 'image/svg+xml' : 'text/html');
    response.end(body);
  } catch { response.writeHead(404); response.end(); }
});
const interval = setInterval(() => { if (streaming) for (const response of clients) deliver(response, 100); }, 20);
let browser;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('uber-device-log.lastDevice', 'android:fixture');
    localStorage.setItem('uber-device-log.bufferSize', '10000');
    localStorage.setItem('uber-device-log.messageOrder', 'bottom');
    localStorage.setItem('uber-device-log.language', 'en');
    window.fixtureLongTasks = [];
    if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes.includes('longtask')) new PerformanceObserver(list => {
      window.fixtureLongTasks.push(...list.getEntries().map(entry => entry.duration));
    }).observe({ type: 'longtask' });
  });
  const state = () => page.evaluate(() => {
    const view = document.querySelector('.logs'), bounds = view.getBoundingClientRect();
    const rows = [...view.querySelectorAll('.entry')];
    const first = rows.find(row => row.getBoundingClientRect().bottom > bounds.top);
    return { rows: rows.length, first: first?.dataset.logKey, firstTop: first?.getBoundingClientRect().top - bounds.top,
      last: rows.at(-1)?.dataset.logKey, remaining: view.scrollHeight - view.scrollTop - view.clientHeight };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => document.querySelector('.precision-bottom')?.textContent.includes('10,000'));
  await page.waitForTimeout(300);
  const initial = await state(); assert.ok(initial.rows < 100); assert.ok(initial.remaining < 5);
  assert.equal(await page.locator('.precision-performance').count(), 0);
  if (releaseCheck) {
    await page.evaluate(() => localStorage.setItem('uber-device-log.performance', 'true'));
    await page.reload();
    await page.waitForTimeout(1200);
    await page.locator('.precision-settings summary').click();
    assert.equal(await page.locator('#settings-performance').count(), 0, 'release settings must omit diagnostics');
    assert.equal(await page.locator('.precision-performance').count(), 0, 'saved preference must not enable release diagnostics');
    assert.deepEqual(errors, []);
    console.log('Release diagnostics remain hidden with a saved enabled preference.');
  } else {
    await page.locator('.precision-settings summary').click();
    await page.getByLabel('Show performance diagnostics', { exact: true }).check();
    await page.locator('.precision-settings header button').click();
    await page.locator('.logs').evaluate(element => element.scrollTop = element.scrollHeight / 2);
    await page.waitForTimeout(200); const anchor = await state();
    streaming = true; await page.waitForTimeout(400); streaming = false; await page.waitForTimeout(100);
    const after = await state(); assert.equal(after.first, anchor.first); assert.ok(Math.abs(after.firstTop - anchor.firstTop) < 5);
    await page.getByRole('button', { name: 'Follow latest', exact: true }).click();
    streaming = true; await page.waitForTimeout(1200); streaming = false; await page.waitForTimeout(250);
    const followed = await state(); assert.ok(followed.rows < 100); assert.ok(followed.remaining < 5);
    await page.waitForFunction(() => document.querySelector('.performance-metrics'));
    await page.evaluate(() => window.scrollTo(0, 0));
    assert.equal(await page.locator('.precision-performance').evaluate(element => {
      const bounds = element.getBoundingClientRect();
      return bounds.top >= 0 && bounds.bottom <= innerHeight && bounds.left >= 0 && bounds.right <= innerWidth;
    }), true, 'enabled debug panel must be visible without page scrolling');
    const diagnostics = await page.locator('.precision-performance').innerText();
    assert.match(diagnostics, /Log processing:.*ms/); assert.match(diagnostics, /Animation callbacks:/);
    assert.ok(Number(/Incoming: ([\d,]+) logs\/s/.exec(diagnostics)?.[1].replaceAll(',', '')) > 0, 'live incoming counter must advance');
    assert.match(diagnostics, /Live buffer: 10,000/);
    await page.locator('.entry input').last().click(); const frozen = await state();
    streaming = true; await page.waitForTimeout(1200); streaming = false; await page.waitForTimeout(100);
    assert.equal((await state()).last, frozen.last);
    assert.ok(Number(/Incoming: ([\d,]+) logs\/s/.exec(await page.locator('.precision-performance').innerText())?.[1].replaceAll(',', '')) > 0, 'paused capture still counts arrivals');
    await page.getByRole('button', { name: 'Select all filtered', exact: true }).click();
    await page.locator('.precision-selectionbar summary').click();
    await page.getByRole('button', { name: 'Structured JSON', exact: true }).click();
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save (10,000)', exact: true }).click();
    const download = await downloadEvent;
    const exported = JSON.parse(await readFile(await download.path(), 'utf8')); assert.equal(exported.entries.length, 10000);
    await page.getByRole('button', { name: /Back to live/ }).click();
    await page.locator('.logs').evaluate(element => element.scrollTop = element.scrollHeight / 2);
    await page.waitForTimeout(200);
    const visibleMessages = page.locator('.entry .precision-msg');
    // A native pointer interaction freezes capture's displayed snapshot.
    await visibleMessages.nth(10).click();
    await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.entry .precision-msg')];
      const range = document.createRange(); range.setStart(rows[10].firstChild, 0); range.setEndAfter(rows[12]);
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    });
    await page.waitForTimeout(100);
    const selectedText = await page.evaluate(() => getSelection().toString()); assert.ok(selectedText.length > 20);
    await page.locator('.logs').evaluate(element => element.scrollTop += 15000);
    await page.waitForTimeout(200); assert.equal(await page.evaluate(() => getSelection().toString()), selectedText);
    await page.evaluate(() => getSelection().removeAllRanges());
    await page.waitForTimeout(100); assert.ok((await state()).rows < 100);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      for (const locale of ['en', 'es', 'de', 'fr', 'it', 'ja', 'zh-CN']) {
        await page.locator('.precision-settings summary').click();
        await page.locator('#settings-language').selectOption(locale);
        await page.locator('.precision-settings header button').click();
        await page.waitForTimeout(60);
        assert.ok((await state()).rows < 100);
        assert.equal(await page.locator('.precision-performance').evaluate(element => {
          const bounds = element.getBoundingClientRect();
          return bounds.top >= 0 && bounds.bottom <= innerHeight && bounds.left >= 0 && bounds.right <= innerWidth;
        }), true, `debug panel visible in ${locale} at ${width}px`);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
        assert.equal(overflow, false, `${locale} at ${width}px overflows`);
      }
      if (process.env.PERFORMANCE_SCREENSHOTS) await page.screenshot({ path: `${process.env.PERFORMANCE_SCREENSHOTS}/logs-${width}.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 390, height: 240 });
    await page.waitForTimeout(120);
    assert.equal(await page.locator('.precision-performance').evaluate(element => getComputedStyle(element).pointerEvents), 'auto');
    await page.locator('.performance-metrics').hover();
    await page.mouse.wheel(0, 160);
    await page.waitForTimeout(100);
    assert.ok(await page.locator('.precision-performance').evaluate(element => element.scrollTop > 0), 'short windows can scroll diagnostics');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('.precision-settings summary').click();
    await page.locator('#settings-language').selectOption('en');
    await page.locator('#settings-order').selectOption('top');
    await page.locator('.precision-settings header button').click();
    await page.locator('.precision-pause').click();
    streaming = true; await page.waitForTimeout(400); streaming = false; await page.waitForTimeout(150);
    assert.ok(await page.locator('.logs').evaluate(element => element.scrollTop < 5));
    await page.locator('.logs').evaluate(element => element.scrollTop = element.scrollHeight / 2);
    await page.waitForTimeout(200); const topAnchor = await state();
    streaming = true; await page.waitForTimeout(400); streaming = false; await page.waitForTimeout(100);
    const topAfter = await state(); assert.equal(topAfter.first, topAnchor.first); assert.ok(Math.abs(topAfter.firstTop - topAnchor.firstTop) < 5);
    assert.deepEqual(errors, []);
    const longTasks = await page.evaluate(() => window.fixtureLongTasks);
    await page.reload();
    await page.waitForFunction(() => document.querySelector('.performance-metrics'));
    assert.equal(await page.locator('.precision-performance').count(), 1);
    await page.getByRole('button', { name: 'Turn off performance diagnostics', exact: true }).click();
    assert.equal(await page.locator('.precision-performance').count(), 0);
    assert.equal(await page.evaluate(() => localStorage.getItem('uber-device-log.performance')), 'false');
    await page.locator('.precision-settings summary').click();
    await page.locator('#settings-performance').check();
    await page.locator('#settings-performance').focus();
    await page.keyboard.press('Space');
    assert.equal(await page.locator('.precision-performance').count(), 0);
    assert.equal(await page.locator('#settings-performance').isChecked(), false);
    const unsupported = await browser.newPage();
    await unsupported.addInitScript(() => {
      localStorage.setItem('uber-device-log.performance', 'true');
      localStorage.setItem('uber-device-log.language', 'en');
      Object.defineProperty(window, 'PerformanceObserver', { value: undefined, configurable: true });
    });
    await unsupported.goto(`http://127.0.0.1:${server.address().port}`);
    await unsupported.waitForFunction(() => document.querySelector('.performance-metrics'));
    assert.match(await unsupported.locator('.precision-performance').innerText(), /unavailable in this browser/);
    await unsupported.close();
    console.log(JSON.stringify({ initial, stableAnchor: after, followed, exported: exported.entries.length,
      diagnostics,
      longTasks: { count: longTasks.length, maxMs: Math.round(Math.max(0, ...longTasks)) }, errors }, null, 2));
  }
} catch (error) {
  console.error(error);
  throw error;
} finally {
  clearInterval(interval);
  await browser?.close();
  for (const response of clients) response.end();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}

import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import { websiteCatalogs } from '../src/i18n/website.ts';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const server = await preview({
  configFile: false,
  root: fileURLToPath(new URL('../website', import.meta.url)),
  build: { outDir: fileURLToPath(new URL('../site-dist', import.meta.url)) },
  preview: { host: '127.0.0.1', port: 0, open: false },
});
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}),
  });
  const address = server.httpServer.address();
  const url = `http://127.0.0.1:${address.port}`;
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  const originalLogs = await page.locator('.flows-records').textContent();
  for (const [locale, catalog] of Object.entries(websiteCatalogs)) {
    await page.locator('#language').selectOption(locale);
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.locator('html').getAttribute('lang'), locale);
      for (const element of await page.locator('#semantic-flows [data-t]').all()) {
        const key = await element.getAttribute('data-t');
        assert.equal(await element.textContent(), catalog[key]);
      }
      assert.equal(await page.locator('.flows-records').textContent(), originalLogs);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${locale} overflows at ${width}px`);
      for (const chapter of ['single-event', 'multipart', 'branching']) {
        const link = page.locator(`.flows-tutorials a[href$="/${chapter}/README.md"]`);
        assert.equal(await link.count(), 1);
        assert.ok((await link.innerText()).trim());
      }
    }
  }
  // The navigation entry and all three tutorial links remain reachable by keyboard.
  await page.reload();
  assert.equal(await page.locator('html').getAttribute('lang'), 'zh-CN');
  const reached = new Set();
  for (let index = 0; index < 32; index++) {
    await page.keyboard.press('Tab');
    const href = await page.evaluate(() => document.activeElement?.getAttribute('href'));
    if (href) reached.add(href);
  }
  assert.ok(reached.has('#semantic-flows'));
  for (const href of await page.locator('.flows-tutorials a').evaluateAll(links => links.map(link => link.href))) assert.ok(reached.has(href), `Keyboard cannot reach ${href}`);
  const staticPage = await browser.newPage({ javaScriptEnabled: false, viewport: { width: 390, height: 1000 } });
  await staticPage.goto(url);
  assert.equal(await staticPage.locator('#flows-title').textContent(), websiteCatalogs.en.siteFlowsTitle);
  assert.equal(await staticPage.locator('.flows-tutorials a').count(), 3);
  await staticPage.close();
  if (process.env.WEBSITE_SCREENSHOT_DIR) {
    await mkdir(process.env.WEBSITE_SCREENSHOT_DIR, { recursive: true });
    for (const [locale, width] of [['en', 1440], ['de', 1440], ['de', 390], ['ja', 390]]) {
      await page.setViewportSize({ width, height: 1100 });
      await page.locator('#language').selectOption(locale);
      await page.locator('#semantic-flows').screenshot({ path: `${process.env.WEBSITE_SCREENSHOT_DIR}/${locale}-${width}.png` });
    }
  }
  assert.deepEqual(errors, []);
  console.log('Website: 7 languages × 4 widths, tutorial links, keyboard access, language persistence and static fallback passed.');
} finally {
  await browser?.close();
  await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
}

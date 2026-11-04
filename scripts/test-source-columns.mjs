// Run after npm run build: node --import tsx scripts/test-source-columns.mjs
import assert from 'node:assert/strict';
import { createSemanticFlowsFixture } from '../server/fixtures/semantic-flows-ui.mts';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
try {
  for (const platform of ['android', 'ios']) {
    const fixture = await createSemanticFlowsFixture(false, platform);
    const server = await new Promise(resolve => { const listening = fixture.app.listen(0, '127.0.0.1', () => resolve(listening)); });
    const url = `http://127.0.0.1:${server.address().port}`;
    try {
      for (const width of [1440, 600, 390]) {
        const page = await browser.newPage({ viewport: { width, height: 1000 } });
        await page.addInitScript(({ platform }) => {
          localStorage.setItem('uber-device-log.language', 'de');
          localStorage.setItem('uber-device-log.lastDevice', `${platform}:semantic-phone`);
        }, { platform });
        await page.goto(url);
        const choices = page.locator('.precision-source-choice');
        await choices.first().waitFor();
        const toggle = async index => { await choices.nth(index).click(); };
        const check = async (native, webview, columns) => {
          await page.waitForFunction(async ({ url, native, webview }) => {
            const state = await (await fetch(`${url}/fixture/state`)).json();
            return state.native === native && state.webview === webview;
          }, { url, native, webview });
          fixture.emit({ event: 'layout', message: 'A long log message '.repeat(25) }, webview);
          const row = page.locator('.precision-row').last();
          await row.waitFor();
          assert.equal(await page.locator('.precision-source-heading').count(), columns ? 1 : 0);
          assert.equal(await row.locator('.precision-entry-source').count(), columns ? 1 : 0);
          const geometry = await row.evaluate(el => {
            const bounds = el.getBoundingClientRect();
            const message = el.querySelector('.precision-message-cell').getBoundingClientRect();
            return { tracks: getComputedStyle(el).gridTemplateColumns.split(' ').length, right: bounds.right, messageRight: message.right };
          });
          const expected = width > 700 ? (native && !webview && platform === 'ios' ? 3 : columns ? 6 : 5)
            : width > 480 ? (native && !webview && platform === 'ios' ? 3 : columns ? 5 : 4)
              : (native && !webview && platform === 'ios' ? 2 : columns ? 4 : 3);
          assert.equal(geometry.tracks, expected, `${platform} at ${width}px`);
          assert.ok(geometry.messageRight <= geometry.right + 1);
          if (process.env.SOURCE_COLUMNS_SCREENSHOTS) await page.screenshot({ path: `${process.env.SOURCE_COLUMNS_SCREENSHOTS}/${platform}-${width}-${native}-${webview}.png`, fullPage: true });
        };
        await check(true, false, false);
        await toggle(1); await check(true, true, true);
        await toggle(0); await check(false, true, false);
        await toggle(0); await check(true, true, true);
        await toggle(1); await check(true, false, false);
        await page.close();
      }
    } finally { await fixture.close(); await new Promise(resolve => server.close(resolve)); }
  }
  console.log('Source columns: Android/iOS, native/WebView/combined, desktop/tablet/mobile passed.');
} finally { await browser.close(); }

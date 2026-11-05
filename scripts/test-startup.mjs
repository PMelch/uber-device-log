// Delay the application bundle to inspect the initial HTML independently of Vue.
import assert from 'node:assert/strict';
import { translate } from '../src/i18n/index.ts';
import { chromium } from 'playwright';
import { createSemanticFlowsFixture } from '../server/fixtures/semantic-flows-ui.mts';
const fixture = await createSemanticFlowsFixture(false);
const server = await new Promise(resolve => { const listener = fixture.app.listen(0, '127.0.0.1', () => resolve(listener)); });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
try {
  for (const locale of ['en', 'de', 'es', 'fr', 'it', 'ja', 'zh-CN']) {
  const page = await browser.newPage({ viewport: { width: 390, height: 700 }, colorScheme: 'dark' });
  await page.addInitScript(locale => localStorage.setItem('uber-device-log.language', locale), locale);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/assets/*.js', async route => { await gate; await route.continue(); });
  const navigation = page.goto(`http://127.0.0.1:${server.address().port}`);
  void navigation.catch(() => {});
  await page.waitForLoadState('commit');
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#app-startup').count(), 1, 'initial HTML shows loading before the app bundle arrives');
  assert.equal(await page.locator('#app-startup').innerText(), translate(locale, 'appLoading'));
  assert.equal(await page.locator('#app-startup').getAttribute('role'), 'status');
  release(); await navigation;
  await page.locator('#precision-design').waitFor();
  assert.equal(await page.locator('#app-startup').count(), 0);
  await page.close();
  }
  console.log('Startup: localized label visible before bundle loading and removed on mount in seven languages.');
} finally { await browser.close(); await fixture.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }

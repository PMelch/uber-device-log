// Run after npm run build. Synthetic Android processes; no device required.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { translate } from '../src/i18n/index.ts';
import { createSemanticFlowsFixture } from '../server/fixtures/semantic-flows-ui.mts';
const fixture = await createSemanticFlowsFixture(false, 'android');
let mode = 'ok';
fixture.app.get('/api/processes', (req, res) => {
  assert.equal(req.query.id, 'semantic-phone');
  if (mode === 'error') return res.status(503).json({ code: 'processUnavailable' });
  res.json({ processes: mode === 'empty' ? [] : [{ pid: 123, name: 'com.example.application' }, { pid: 456, name: 'com.example.application:worker' }, { pid: 789, name: 'com.vendor.very.long.package.name.for.a.background.service:isolated_worker' }, ...Array.from({ length: 997 }, (_, i) => ({ pid: 10000 + i, name: `com.fixture.process${i}` }))] });
});
const server = await new Promise(resolve => { const listener = fixture.app.listen(0, '127.0.0.1', () => resolve(listener)); });
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
const errors = [];
try {
  await mkdir('/tmp/process-search-screenshots', { recursive: true });
  for (const width of [1440, 390, 320]) for (const locale of ['en', 'de', 'es', 'fr', 'it', 'ja', 'zh-CN']) {
    const page = await browser.newPage({ viewport: { width, height: width === 320 ? 480 : 900 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(locale => { localStorage.setItem('uber-device-log.language', locale); localStorage.setItem('uber-device-log.lastDevice', 'android:semantic-phone'); }, locale);
    const t = key => translate(locale, key);
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const filters = page.locator('.source-filters').first();
    await filters.locator('.overlay-trigger').click();
    await page.locator('.source-advanced summary').click();
    assert.equal(await page.locator('.source-pid-control').count(), 1, 'PID search is grouped with the PID input');
    const filterPanel = page.locator('.source-filter-panel:popover-open');
    assert.equal(await filterPanel.evaluate(el => el.scrollWidth <= el.clientWidth), true);
    await page.screenshot({ animations: 'disabled', path: `/tmp/process-search-screenshots/filters-${locale}-${width}.png` });
    await page.locator('input[id$="-tag"]').fill('TargetTag');
    const trigger = page.getByRole('button', { name: t('processFind'), exact: true });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: t('processFind') });
    const search = dialog.getByRole('searchbox');
    await dialog.locator('li').nth(2).waitFor();
    assert.equal(await search.evaluate(el => document.activeElement === el), true);
    assert.equal(await dialog.locator('li').count(), 1000);
    const initialSearch = await search.boundingBox();
    const list = dialog.locator('.process-results');
    assert.ok(await list.evaluate(el => el.scrollHeight > el.clientHeight));
    await list.evaluate(el => { el.scrollTop = el.scrollHeight; });
    assert.equal((await search.boundingBox()).y, initialSearch.y);
    assert.ok(await dialog.evaluate(el => el.scrollHeight <= el.clientHeight + 1));
    await dialog.locator('footer').waitFor({ state: 'visible' });
    await page.screenshot({ path: `/tmp/process-search-screenshots/full-${locale}-${width}.png` });
    await search.fill('application');
    assert.equal(await dialog.locator('li').count(), 2);
    assert.equal(await list.evaluate(el => el.scrollTop), 0);
    await page.screenshot({ path: `/tmp/process-search-screenshots/${locale}-${width}.png` });
    assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth), true);
    await search.fill('456');
    await search.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await page.locator('input[id$="-pid"]').inputValue(), '456');
    assert.equal(await page.locator('input[id$="-tag"]').inputValue(), 'TargetTag');
    assert.equal(await trigger.evaluate(el => document.activeElement === el), true);
    await trigger.click();
    await dialog.locator('li').nth(2).waitFor();
    await search.fill('no-such-app');
    await dialog.getByText(t('processEmpty')).waitFor();
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await trigger.evaluate(el => document.activeElement === el), true);
    mode = 'error';
    await trigger.click();
    await dialog.getByRole('alert').waitFor();
    assert.equal(await dialog.getByRole('alert').innerText(), t('processUnavailable'));
    mode = 'empty';
    await dialog.getByRole('button', { name: t('processRefresh') }).click();
    await dialog.getByText(t('processEmpty')).waitFor();
    mode = 'ok';
    await dialog.getByRole('button', { name: t('processRefresh') }).click();
    await dialog.locator('li').nth(2).waitFor();
    if (locale === 'de') {
      await search.fill('com.vendor');
      await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
      await page.screenshot({ path: `/tmp/process-search-screenshots/dark-${width}.png` });
    }
    await dialog.getByRole('button', { name: t('close'), exact: true }).first().click();
    if (locale === 'de') await page.screenshot({ animations: 'disabled', path: `/tmp/process-search-screenshots/filters-dark-${width}.png` });
    assert.equal(await trigger.evaluate(el => document.activeElement === el), true);
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log('Process search: seven locales, desktop/mobile, keyboard apply/Escape/focus, empty/error/refresh passed.');
} finally {
  await browser.close(); await fixture.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}

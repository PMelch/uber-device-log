// Run after npm run build with node --import tsx. All evidence and downloads are fictional.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createSemanticFlowsFixture } from '../server/fixtures/semantic-flows-ui.mts';
import { fixtureBundle } from '../server/fixtures/flow-bundle.ts';
import { translate } from '../src/i18n/index.ts';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fixture = await createSemanticFlowsFixture(false);
const files = new Map([
  ['/global.blueprint', fixtureBundle('browser-global', 'bundle-browser')],
  ['/project.blueprint', fixtureBundle('browser-project', 'bundle-project')],
  ['/broken.blueprint', Buffer.from('not a ZIP')],
]);
const download = createServer((request, response) => {
  if (request.url === '/slow.blueprint') return; // Cancellation must abort the download before publishing.
  const bytes = files.get(request.url);
  response.writeHead(bytes ? 200 : 404); response.end(bytes);
});
await new Promise(resolve => download.listen(0, '127.0.0.1', resolve));
const downloads = `http://127.0.0.1:${download.address().port}`;
const server = await new Promise(resolve => { const listener = fixture.app.listen(0, '127.0.0.1', () => resolve(listener)); });
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  page.setDefaultTimeout(12000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => { localStorage.setItem('uber-device-log.language', 'en'); localStorage.setItem('uber-device-log.lastDevice', 'ios:semantic-phone'); });
  await page.goto(origin);
  await page.locator('#workspace-tab-flows').click();
  const manager = page.locator('.flow-source-manager');
  await manager.locator('summary').focus(); await page.keyboard.press('Enter');
  await manager.locator('#flow-bundle-url').waitFor();
  for (let attempt = 0; attempt < 60; attempt++) {
    if ((await (await fetch(`${origin}/fixture/state`)).json()).native) break;
    await delay(100);
  }
  const source = id => manager.locator(`[data-source-id="${id}"]`);
  const install = async (file, scope) => {
    await manager.locator('#flow-bundle-url').fill(`${downloads}/${file}.blueprint`);
    await manager.locator('#flow-bundle-scope').selectOption(scope);
    const response = page.waitForResponse(response => response.url().endsWith('/bundles/install'));
    await manager.getByRole('button', { name: translate('en', 'flowsBundleInstall'), exact: true }).click();
    return await (await response).status();
  };
  assert.equal(await install('global', 'global'), 200);
  const global = source('global:bundle:browser-global'), toggle = global.getByRole('switch');
  await toggle.waitFor();
  assert.equal(await toggle.getAttribute('aria-checked'), 'false');
  assert.ok((await global.innerText()).includes('Example flow bundle'), 'authored description is visible');
  assert.deepEqual(await readFile(join(fixture.homeDirectory, '.udl/bundles/browser-global.blueprint')), files.get('/global.blueprint'));
  fixture.emit({ event: 'bundle-browser.start', id: 'disabled' });
  await delay(300);
  assert.equal(await page.locator('.flow-card').count(), 0);
  const setEnabled = async enabled => {
    const response = page.waitForResponse(response => response.url().endsWith('/bundles/activation'));
    await toggle.focus(); await page.keyboard.press('Space');
    assert.equal((await response).status(), 200);
    await page.waitForFunction(({ id, enabled }) => document.querySelector(`[data-source-id="${id}"] [role="switch"]`)?.getAttribute('aria-checked') === String(enabled), { id: 'global:bundle:browser-global', enabled });
    // A successful reload is acknowledged by the actual analysis worker before the loading notice clears.
    await page.waitForFunction(() => !document.querySelector('.flow-notice[role="status"]'));
  };
  await setEnabled(true);
  fixture.emit({ event: 'bundle-browser.start', id: 'before-disable' });
  const card = page.locator('.flow-card').filter({ hasText: 'bundle-browser' });
  await card.locator('[data-outcome="running"]').waitFor();
  await setEnabled(false);
  await card.locator('[data-outcome="interrupted"]').waitFor();
  fixture.emit({ event: 'bundle-browser.done', id: 'before-disable' });
  fixture.emit({ event: 'bundle-browser.start', id: 'during-disable' });
  await delay(300);
  assert.equal(await card.count(), 1);
  await setEnabled(true);
  fixture.emit({ event: 'bundle-browser.start', id: 'after-enable' });
  await page.locator('.flow-card [data-outcome="running"]').waitFor();
  fixture.emit({ event: 'bundle-browser.done', id: 'after-enable' });
  await page.locator('.flow-card [data-outcome="completed"]').waitFor();
  assert.equal(await card.count(), 2);
  assert.equal(await install('project', 'project'), 200);
  await source('project:bundle:browser-project').waitFor();
  await access(join(fixture.projectDirectory, '.udl/bundles/browser-project.blueprint'));
  const selections = await readFile(join(fixture.projectDirectory, '.udl/config.yaml'), 'utf8');
  assert.match(selections, /browser-global: true/);
  await assert.rejects(access(join(fixture.homeDirectory, '.udl/config.yaml')), 'project selections do not write global configuration');
  assert.equal(await install('broken', 'global'), 400);
  await manager.locator('.flow-validation[role="status"]').waitFor();
  // A pending install can be cancelled without losing the current definitions or selection.
  await manager.locator('#flow-bundle-url').fill(`${downloads}/slow.blueprint`);
  await manager.getByRole('button', { name: translate('en', 'flowsBundleInstall'), exact: true }).click();
  await manager.getByRole('button', { name: translate('en', 'flowsBundleCancel'), exact: true }).click();
  await manager.getByRole('status').filter({ hasText: translate('en', 'flowsBundleCancelled') }).waitFor();
  assert.equal(await toggle.getAttribute('aria-checked'), 'true');
  // Keep a validation status visible while switching languages; technical details remain verbatim.
  assert.equal(await install('broken', 'global'), 400);
  for (const width of [1440, 390, 320]) for (const locale of ['en', 'de', 'es', 'fr', 'it', 'ja', 'zh-CN']) {
    await page.setViewportSize({ width, height: 1080 });
    await page.locator('.precision-settings summary').click();
    await page.locator('#settings-language').selectOption(locale);
    await page.locator('#settings-theme').selectOption(width === 320 ? 'dark' : 'light');
    await page.locator('.precision-settings header button').click();
    assert.equal(await manager.locator('summary').innerText(), translate(locale, 'flowsBlueprintSources'));
    await manager.getByRole('button', { name: translate(locale, 'flowsBundleInstall'), exact: true }).waitFor();
    assert.equal(await toggle.getAttribute('aria-label'), translate(locale, 'flowsBundleDisableLabel', { name: 'Example bundle' }));
    assert.ok((await manager.getByRole('status').first().innerText()).includes(translate(locale, 'flowsNetworkError')));
    assert.ok((await global.innerText()).includes('Example flow bundle'));
    await toggle.focus(); assert.equal(await toggle.evaluate(node => document.activeElement === node), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${locale} ${width}px`);
    if (process.env.SEMANTIC_FLOWS_SCREENSHOTS && locale === 'de') {
      await mkdir(process.env.SEMANTIC_FLOWS_SCREENSHOTS, { recursive: true });
      await manager.scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(process.env.SEMANTIC_FLOWS_SCREENSHOTS, `bundles-${width}.png`), fullPage: true });
    }
  }
  assert.deepEqual(errors, []);
  console.log('Bundle browser checks passed: both install targets, authored description, disabled defaults, worker interruption/re-enable, cancellation, validation, seven languages, keyboard access and three viewport widths.');
} finally {
  await browser?.close();
  download.closeAllConnections(); await new Promise(resolve => download.close(resolve));
  await fixture.close(); await new Promise(resolve => server.close(resolve));
}

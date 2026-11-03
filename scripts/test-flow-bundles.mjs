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
  const trigger = page.locator('.flow-source-trigger');
  assert.equal(await manager.isVisible(), false, 'configuration is not shown inline');
  assert.equal(await trigger.getAttribute('aria-haspopup'), 'dialog');
  const openManager = async () => { await trigger.focus(); await page.keyboard.press('Enter'); await manager.waitFor({ state: 'visible' }); };
  await openManager();
  assert.equal(await manager.evaluate(node => node.matches('dialog:modal')), true, 'configuration uses native modality');
  assert.equal(await manager.locator('.flow-source-search').evaluate(node => document.activeElement === node), true, 'opening focuses source search');
  for (let index = 0; index < 12; index++) {
    await page.keyboard.press('Tab');
    assert.equal(await manager.evaluate(node => node.contains(document.activeElement)), true, 'Tab focus stays inside modal');
  }
  for (let index = 0; index < 12; index++) {
    await page.keyboard.press('Shift+Tab');
    assert.equal(await manager.evaluate(node => node.contains(document.activeElement)), true, 'reverse Tab stays inside modal');
  }
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).overflow), 'hidden', 'background scrolling is locked');
  await page.keyboard.press('Escape');
  assert.equal(await manager.isVisible(), false);
  assert.notEqual(await page.evaluate(() => getComputedStyle(document.documentElement).overflow), 'hidden', 'closing releases background scrolling');
  assert.equal(await trigger.evaluate(node => document.activeElement === node), true, 'Escape restores trigger focus');
  await openManager();
  await manager.locator('.flow-source-header-close').click();
  assert.equal(await manager.isVisible(), false);
  await openManager();
  await manager.locator('.flow-source-footer button').click();
  assert.equal(await trigger.evaluate(node => document.activeElement === node), true, 'footer Close restores trigger focus');
  await openManager();
  await manager.locator('.flow-source-search').waitFor();
  const inspector = manager.locator('.flow-source-inspector');
  const installation = manager.locator('.flow-bundle-disclosure');
  assert.equal(await installation.getAttribute('open'), null, 'installation starts collapsed');
  await manager.getByRole('button', { name: translate('en', 'flowsInstallTitle'), exact: true }).click();
  await manager.locator('#flow-bundle-url').waitFor({ state: 'visible' });
  assert.equal(await manager.locator('#flow-bundle-url').evaluate(node => document.activeElement === node), true, 'header installation action focuses the URL');
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
  await global.locator('.flow-source-select').focus(); await page.keyboard.press('Enter');
  assert.equal(await global.locator('.flow-source-select').getAttribute('aria-pressed'), 'true');
  assert.ok((await inspector.innerText()).includes('Example flow bundle'), 'authored description appears in details');
  assert.ok((await inspector.innerText()).includes('bundle-browser'), 'inactive bundle inventory remains inspectable');
  assert.equal(await global.locator('code').count(), 0, 'technical IDs do not clutter source rows');
  await manager.locator('.flow-source-search').fill('not-an-existing-source');
  assert.equal(await manager.locator('[data-source-id]').count(), 0);
  assert.equal(await inspector.count(), 0, 'no stale details for an empty search');
  await manager.locator('.flow-source-search').fill('');
  assert.equal(await global.locator('.flow-source-select').getAttribute('aria-pressed'), 'true', 'selection survives filtering');
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
    assert.equal(await global.locator('.flow-source-select').getAttribute('aria-pressed'), 'true', 'selection survives snapshot reload');
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
  // A fresh manager initially chooses the enabled bundle without an explicit row click.
  await page.reload(); await page.locator('#workspace-tab-flows').click();
  await openManager();
  assert.equal(await global.locator('.flow-source-select').getAttribute('aria-pressed'), 'true');
  await setEnabled(false);
  await setEnabled(true);
  await manager.getByRole('button', { name: translate('en', 'flowsInstallTitle'), exact: true }).click();
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
  await manager.locator('.flow-source-header-close').click();
  assert.equal(await manager.isVisible(), false, 'closing is available during installation');
  await openManager();
  assert.equal(await manager.locator('#flow-bundle-url').inputValue(), `${downloads}/slow.blueprint`, 'reopening retains URL draft');
  await manager.getByRole('button', { name: translate('en', 'flowsBundleCancel'), exact: true }).click();
  await manager.getByRole('status').filter({ hasText: translate('en', 'flowsBundleCancelled') }).waitFor();
  assert.equal(await toggle.getAttribute('aria-checked'), 'true');
  // Local archives travel as bounded binary uploads, never as server filesystem paths.
  await manager.locator('#flow-bundle-source').selectOption('file');
  await manager.getByRole('button', { name: translate('en', 'flowsBundleInstall'), exact: true }).click();
  await manager.getByRole('status').filter({ hasText: translate('en', 'flowsBundleInvalidFile') }).waitFor();
  const localBytes = fixtureBundle('browser-local', 'local-event');
  const localName = 'Downloaded bundle with a very long descriptive filename.blueprint';
  const upload = async scope => {
    await manager.locator('#flow-bundle-scope').selectOption(scope);
    const pending = page.waitForResponse(response => response.url().includes('/bundles/upload?'));
    await manager.getByRole('button', { name: translate('en', 'flowsBundleInstall'), exact: true }).click();
    return (await pending).status();
  };
  await manager.locator('#flow-bundle-file').setInputFiles({ name: localName, mimeType: 'application/octet-stream', buffer: localBytes });
  await page.keyboard.press('Escape'); await openManager();
  assert.equal(await manager.locator('#flow-bundle-filename').innerText(), localName, 'file draft survives closing');
  for (const scope of ['global', 'project']) {
    assert.equal(await upload(scope), 200);
    await source(`${scope}:bundle:browser-local`).waitFor();
    assert.equal(await source(`${scope}:bundle:browser-local`).getByRole('switch').getAttribute('aria-checked'), 'false');
    assert.deepEqual(await readFile(join(scope === 'global' ? fixture.homeDirectory : fixture.projectDirectory, '.udl/bundles/browser-local.blueprint')), localBytes);
    assert.equal(await upload(scope), 409);
  }
  await manager.locator('#flow-bundle-file').setInputFiles({ name: 'broken.blueprint', mimeType: 'application/octet-stream', buffer: Buffer.from('invalid ZIP') });
  assert.equal(await upload('global'), 400);
  for (const invalid of [{ name: 'wrong.zip', buffer: localBytes }, { name: 'large.blueprint', buffer: Buffer.alloc(4 * 1024 * 1024 + 1) }]) {
    await manager.locator('#flow-bundle-file').setInputFiles({ ...invalid, mimeType: 'application/octet-stream' });
    await manager.getByRole('button', { name: translate('en', 'flowsBundleInstall'), exact: true }).click();
    await manager.getByRole('status').filter({ hasText: translate('en', 'flowsBundleInvalidFile') }).waitFor();
  }
  await manager.locator('#flow-bundle-file').setInputFiles({ name: localName, mimeType: 'application/octet-stream', buffer: localBytes });
  await manager.locator('#flow-bundle-source').selectOption('url');
  // Keep a validation status visible while switching languages; technical details remain verbatim.
  assert.equal(await install('broken', 'global'), 400);
  await manager.locator('#flow-bundle-source').selectOption('file');
  for (const width of [1440, 390, 320]) for (const locale of ['en', 'de', 'es', 'fr', 'it', 'ja', 'zh-CN']) {
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width, height: width <= 390 ? 740 : 1080 });
    await page.locator('.precision-settings summary').click();
    await page.locator('#settings-language').selectOption(locale);
    await page.locator('#settings-theme').selectOption(width === 320 ? 'dark' : 'light');
    await page.locator('.precision-settings header button').click();
    assert.equal(await trigger.innerText(), translate(locale, 'flowsBlueprintSources'));
    await openManager();
    assert.equal((await manager.locator('#flow-source-title').innerText()).replace(/\s+/g, ' '), translate(locale, 'flowsBlueprintSources') + ' ' + 'test_flow_project');
    const box = await manager.boundingBox();
    const viewport = page.viewportSize();
    assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, 'dialog fits the viewport');
    assert.equal(await manager.evaluate(node => node.scrollWidth <= node.clientWidth), true, 'dialog has no horizontal overflow');
    assert.equal(await manager.locator('.flow-source-footer').isVisible(), true);
    const closeBox = await manager.locator('.flow-source-footer button').boundingBox();
    assert.ok(closeBox.y >= 0 && closeBox.y + closeBox.height <= viewport.height + 1, 'footer Close remains reachable without scrolling');
    await manager.getByRole('button', { name: translate(locale, 'flowsBundleInstall'), exact: true }).waitFor();
    assert.equal(await toggle.getAttribute('aria-label'), translate(locale, 'flowsBundleDisableLabel', { name: 'Example bundle' }));
    assert.ok((await manager.getByRole('status').first().innerText()).includes(translate(locale, 'flowsNetworkError')));
    assert.ok((await inspector.innerText()).includes('Example flow bundle'));
    assert.equal(await manager.locator('.flow-source-search').getAttribute('aria-label'), translate(locale, 'flowsSourceSearch'));
    assert.equal(await manager.locator('[data-source-id="global:loose"] [role="switch"]').count(), 0, 'loose sources never have switches');
    const installAction = manager.locator('.flow-source-install-action');
    await installAction.hover();
    const contrast = await installAction.evaluate(node => {
      const style = getComputedStyle(node);
      const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => value / 255)
        .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
        .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
      const values = [luminance(style.color), luminance(style.backgroundColor)].sort((a, b) => b - a);
      return (values[0] + .05) / (values[1] + .05);
    });
    assert.ok(contrast >= 4.5, `install action text contrast ${contrast.toFixed(2)} in ${locale} ${width}px`);
    assert.equal(await manager.locator('#flow-bundle-file-button').innerText(), translate(locale, 'flowsBundleChooseFile'));
    await manager.locator('#flow-bundle-file-button').focus();
    assert.equal(await manager.locator('#flow-bundle-file-button').evaluate(node => document.activeElement === node), true);
    await toggle.focus(); assert.equal(await toggle.evaluate(node => document.activeElement === node), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${locale} ${width}px`);
    if (width <= 390) {
      for (const label of await manager.locator('.flow-source-label').all()) {
        const available = await label.evaluate(node => {
          const button = node.parentElement, style = getComputedStyle(button);
          return button.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
            - button.querySelector('svg').getBoundingClientRect().width - parseFloat(style.columnGap);
        });
        assert.ok(available >= 120, `${locale} ${width}px source text has ${available}px available`);
      }
    }
    if (process.env.SEMANTIC_FLOWS_SCREENSHOTS && locale === 'de') {
      await mkdir(process.env.SEMANTIC_FLOWS_SCREENSHOTS, { recursive: true });
      await manager.locator('#flow-bundle-file-button').scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(process.env.SEMANTIC_FLOWS_SCREENSHOTS, `bundles-${width}.png`) });
    }
  }
  // Compact landscape still keeps close controls inside the viewport while body scrolls.
  await page.setViewportSize({ width: 844, height: 390 });
  const compactBox = await manager.boundingBox();
  assert.ok(compactBox.y >= 0 && compactBox.y + compactBox.height <= 391);
  await manager.locator('.flow-source-footer button').click();
  assert.equal(await manager.isVisible(), false);
  assert.equal(await trigger.evaluate(node => document.activeElement === node), true);
  assert.deepEqual(errors, []);
  console.log('Bundle browser checks passed: grouped source search/selection and empty state, inactive inventory, stable selection across reloads, collapsed installation/focus, both install targets, worker interruption/re-enable, cancellation, validation, seven languages, keyboard access and three viewport widths.');
} finally {
  await browser?.close();
  download.closeAllConnections(); await new Promise(resolve => download.close(resolve));
  await fixture.close(); await new Promise(resolve => server.close(resolve));
}

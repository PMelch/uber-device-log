// Run after npm run build: node --import tsx scripts/test-semantic-flows.mjs
// PLAYWRIGHT_MODULE and CHROME_EXECUTABLE optionally select an installed browser runtime.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { translate } from '../src/i18n/index.ts';
import { createSemanticFlowsFixture } from '../server/fixtures/semantic-flows-ui.mts';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fixture = await createSemanticFlowsFixture(false);
const server = await new Promise(resolve => { const listening = fixture.app.listen(0, '127.0.0.1', () => resolve(listening)); });
const url = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => { localStorage.setItem('uber-device-log.language', 'en'); localStorage.setItem('uber-device-log.lastDevice', 'ios:semantic-phone'); });
  await page.goto(url);
  await page.getByRole('button', { name: 'Show WebView console for Shop WebView · example.test on iPhone Semantic Fixture', exact: true }).first().click();
  // Selecting the WebView can switch capture to it; explicitly include native logs too.
  const native = page.getByRole('checkbox', { name: 'Include Device logs', exact: true });
  if (await native.count() && !await native.isChecked()) await page.locator('.precision-source-choice').filter({ has: native }).click();
  const waitSources = async () => {
    for (let attempt = 0; attempt < 60; attempt++) {
      const state = await (await fetch(`${url}/fixture/state`)).json();
      if (state.native && state.webview) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Both synthetic source SSE connections must be open before replay.');
  };
  await waitSources();
  await page.getByRole('tab', { name: /^Flows/ }).click();
  await fetch(`${url}/fixture/replay`, { method: 'POST' });
  await page.waitForFunction(() => document.querySelectorAll('.flow-card').length >= 6).catch(async error => { console.error(await page.locator('body').innerText(), errors); throw error; });
  await page.waitForFunction(() => document.querySelectorAll('.flow-card[data-outcome="completed"]').length >= 3);
  assert.equal(await page.locator('.flow-card[data-outcome="failed"]').count(), 1);
  await page.waitForFunction(() => document.querySelector('.flow-card[data-outcome="timed_out"]'));
  assert.equal(await page.locator('.flow-card[data-outcome="completed"]').count(), 3, 'two concurrent purchases and login complete');
  assert.equal(await page.locator('.flow-card[data-outcome="interrupted"]').count(), 1, 'missing start cannot prove complete execution');
  const purchase = page.locator('.flow-card[data-outcome="completed"]').filter({ has: page.getByRole('heading', { name: 'Purchase', exact: true }) }).first();
  assert.equal(await page.locator('.flow-card').filter({ has: page.getByRole('heading', { name: 'Purchase', exact: true }) }).count(), 3);
  await purchase.getByRole('button', { name: 'Timeline', exact: true }).click();
  await page.locator('.flow-timeline').getByRole('button', { name: /Receive store result/ }).click();
  assert.ok(!(await page.locator('.flow-inspector').innerText()).includes('SECRET-RECEIPT'));
  await page.getByRole('button', { name: 'Reveal sensitive values', exact: true }).click();
  assert.ok((await page.locator('.flow-inspector').innerText()).includes('SECRET-RECEIPT'));
  await page.locator('.flow-timeline').getByRole('button', { name: /Send receipt and payload/ }).click();
  await page.getByRole('button', { name: 'Matching', exact: true }).click();
  await page.getByRole('button', { name: 'Reveal sensitive values', exact: true }).click();
  assert.ok((await page.locator('.flow-inspector').innerText()).includes('transaction_id == receipt.storeTransactionId'));
  await page.getByRole('button', { name: 'All flows', exact: true }).click();
  await purchase.getByRole('button', { name: 'Info', exact: true }).click();
  assert.ok((await page.locator('.flow-info-body').innerText()).includes('PAYMENT_DECLINED'));
  assert.ok((await page.locator('.flow-info-body').innerText()).includes('Start Play Store purchase'));
  await page.getByRole('button', { name: 'Edit YAML', exact: true }).click();
  await page.locator('.flow-filelist').getByRole('button', { name: 'purchase.yaml', exact: true }).click();
  const original = await page.locator('#flow-yaml').inputValue();
  await page.locator('#flow-yaml').fill('version: [broken');
  await page.getByRole('button', { name: 'Validate draft', exact: true }).click();
  await page.locator('.flow-validation').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Save blueprint', exact: true }).isDisabled(), true);
  await page.locator('#flow-yaml').fill(original + '\n# Browser regression save\n');
  await page.getByRole('button', { name: 'Validate draft', exact: true }).click();
  await page.getByText('Blueprint is valid.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Save blueprint', exact: true }).click();
  await page.getByText('Blueprint saved.', { exact: true }).waitFor();
  const file = join(fixture.projectDirectory, '.udl/flows', 'purchase.yaml');
  assert.ok((await readFile(file, 'utf8')).includes('# Browser regression save'));
  await writeFile(file, (await readFile(file, 'utf8')) + '# External edit\n');
  await page.locator('#flow-yaml').fill(original + '\n# Unsaved local draft\n');
  await page.getByRole('button', { name: 'Validate draft', exact: true }).click();
  await page.getByText('Blueprint is valid.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Save blueprint', exact: true }).click();
  await page.getByText('File changed on disk. Keep your draft and reload files before saving.', { exact: true }).waitFor();
  assert.ok((await page.locator('#flow-yaml').inputValue()).includes('# Unsaved local draft'));
  await page.locator('.precision-settings summary').click();
  await page.locator('#settings-language').selectOption('de');
  await page.locator('.precision-settings header button').click();
  await page.getByText(translate('de', 'flowsConflict'), { exact: true }).waitFor();
  assert.ok((await page.locator('#flow-yaml').inputValue()).includes('# Unsaved local draft'));
  await page.locator('.precision-settings summary').click();
  await page.locator('#settings-language').selectOption('en');
  await page.locator('.precision-settings header button').click();

  await page.getByRole('button', { name: '+ New blueprint', exact: true }).click();
  await page.locator('#flow-filename').fill('browser-created.yaml');
  await page.getByRole('button', { name: 'Validate draft', exact: true }).click();
  await page.getByText('Blueprint is valid.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Save blueprint', exact: true }).click();
  await page.getByText('Blueprint saved.', { exact: true }).waitFor();
  assert.ok((await readFile(join(fixture.projectDirectory, '.udl/flows', 'browser-created.yaml'), 'utf8')).includes('id: new-flow'));

  await page.getByRole('button', { name: 'All flows', exact: true }).click();
  await page.locator('.flow-toolbar input').fill('CHECKSUM_MISMATCH');
  assert.equal(await page.locator('.flow-card').count(), 1);
  await page.locator('.flow-toolbar input').fill('');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1080 });
    for (const locale of ['en', 'es', 'de', 'fr', 'it', 'ja', 'zh-CN']) {
      await page.locator('.precision-settings summary').click();
      await page.locator('#settings-language').selectOption(locale);
      await page.locator('.precision-settings header button').click();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${locale} at ${width}px`);
      if (locale === 'de' && process.env.SEMANTIC_FLOWS_SCREENSHOTS) { await mkdir(process.env.SEMANTIC_FLOWS_SCREENSHOTS, { recursive: true }); await page.screenshot({ path: join(process.env.SEMANTIC_FLOWS_SCREENSHOTS, `flows-${width}-de.png`), fullPage: true }); }
    }
    await page.locator('.precision-settings summary').click();
    await page.locator('#settings-language').selectOption('en');
    await page.locator('#settings-theme').selectOption(width === 390 ? 'dark' : 'light');
    await page.locator('.precision-settings header button').click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `no page overflow at ${width}px`);
    if (process.env.SEMANTIC_FLOWS_SCREENSHOTS) { await mkdir(process.env.SEMANTIC_FLOWS_SCREENSHOTS, { recursive: true }); await page.screenshot({ path: join(process.env.SEMANTIC_FLOWS_SCREENSHOTS, `flows-${width}.png`), fullPage: true }); }
  }
  await page.locator('.flow-workspace').getByRole('button', { name: 'Clear', exact: true }).click();
  assert.equal(await page.locator('.flow-card').count(), 0);
  assert.deepEqual(errors, []);
  console.log('Semantic Flows browser checks passed: concurrent correlation, outcomes, evidence privacy, blueprint validation/save/conflict, search, clear, desktop/mobile.');
} finally {
  await browser?.close();
  await fixture.close();
  await new Promise(resolve => server.close(resolve));
}

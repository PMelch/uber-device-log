// Run after npm run build; uses synthetic evidence, never a real banking service.
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { translate } from '../src/i18n/index.ts';
import { createSemanticFlowsFixture } from '../server/fixtures/semantic-flows-ui.mts';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fixture = await createSemanticFlowsFixture(false);
const server = await new Promise(resolve => { const listener = fixture.app.listen(0, '127.0.0.1', () => resolve(listener)); });
const url = `http://127.0.0.1:${server.address().port}`;
const blueprint = {
  version: 1, id: 'labels', name: 'Label privacy fixture', label: 'Transfer requested', start: 'start', timeout: '90s', correlation: { scope: 'device-session', primary: 'id' },
  steps: [
    { id: 'start', name: 'Requested', match: { json: { path: 'event', equals: 'label.start' } }, extract: { id: { json: 'id', required: true }, recipient: { json: 'recipient', result: true, sensitive: true }, amount: { json: 'amount', result: true }, internal: { json: 'internal' } }, next: ['registered'] },
    { id: 'registered', name: 'Registered', match: { json: { path: 'event', equals: 'label.registered' } }, extract: { id: { json: 'id', required: true }, reference: { json: 'reference', required: true, result: true } }, label: 'Transfer {registered.reference} registered', next: ['sent'] },
    { id: 'sent', name: 'Sent for processing', match: { json: { path: 'event', equals: 'label.sent' } }, extract: { id: { json: 'id', required: true } }, next: ['done'] },
    { id: 'done', name: 'Settled', match: { json: { path: 'event', equals: 'label.done' } }, extract: { id: { json: 'id', required: true }, amount: { json: 'amount', result: true } }, label: [{ text: 'Transfer {registered.reference}: ' }, { text: 'successful', tone: 'success' }, { text: ' for {start.recipient}' }], outcome: 'completed' },
  ],
};
let browser;
try {
  await writeFile(join(fixture.projectDirectory, '.udl/flows', 'labels.yaml'), JSON.stringify(blueprint));
  const snapshot = await (await fetch(`${url}/api/flows/snapshot`)).json();
  const reload = await fetch(`${url}/api/flows/reload`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Flow-Token': snapshot.token }, body: '{}' });
  assert.equal(reload.status, 200);
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  page.setDefaultTimeout(12000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => { localStorage.setItem('uber-device-log.language', 'en'); localStorage.setItem('uber-device-log.lastDevice', 'ios:semantic-phone'); });
  await page.goto(url);
  await page.getByRole('tab', { name: /^Flows/ }).click();
  await page.getByRole('group', { name: 'Flow display', exact: true }).waitFor();
  for (let attempt = 0; attempt < 60; attempt++) {
    if ((await (await fetch(`${url}/fixture/state`)).json()).native) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  fixture.emit({ event: 'label.start', id: 't1', amount: 125, recipient: 'PRIVATE-BANK-ACCOUNT', internal: 'INTERNAL-NOT-A-RESULT' });
  await page.getByRole('heading', { name: 'Transfer requested', exact: true }).waitFor();
  const card = page.locator('.flow-card');
  assert.ok(await card.locator('.flow-node').count());
  assert.equal(await card.locator('.flow-status-spinner').count(), 1);
  assert.equal(await card.locator('.flow-badge').innerText(), 'In progress');
  assert.equal(await card.locator('.flow-results dd').allTextContents().then(values => values.includes('125')), true);
  assert.ok(!(await card.innerHTML()).includes('PRIVATE-BANK-ACCOUNT'));
  assert.ok(!(await card.innerText()).includes('INTERNAL-NOT-A-RESULT'));
  const condensed = page.getByRole('button', { name: 'Condensed', exact: true });
  await condensed.focus(); await page.keyboard.press('Space');
  assert.equal(await card.locator('.flow-node, svg').count(), 0, 'condensed overview must not render nodes or edges');
  assert.equal(await condensed.getAttribute('aria-pressed'), 'true');
  assert.equal(await card.locator('.flow-status-spinner').count(), 1, 'condensed retains the in-progress indicator');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await card.locator('.flow-status-spinner').evaluate(el => getComputedStyle(el).animationName), 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  fixture.emit({ event: 'label.registered', id: 't1', reference: '<img src=x onerror=alert(1)>' });
  await page.getByRole('heading', { name: 'Transfer <img src=x onerror=alert(1)> registered', exact: true }).waitFor();
  assert.equal(await card.locator('img').count(), 0);
  fixture.emit({ event: 'label.sent', id: 't1' });
  await page.waitForTimeout(350);
  assert.equal(await card.locator('h2').innerText(), 'Transfer <img src=x onerror=alert(1)> registered', 'unlabeled accepted event keeps last main label');
  fixture.emit({ event: 'label.done', id: 't1', amount: 124 });
  await card.locator('.flow-label-success').waitFor();
  assert.equal(await card.locator('.flow-status-spinner').count(), 0, 'terminal events remove the progress indicator');
  assert.ok((await card.locator('h2').innerText()).includes('successful'));
  assert.equal(await card.locator('.flow-results dd').allTextContents().then(values => values.includes('124')), true);
  const search = page.locator('.flow-toolbar input');
  await search.fill('PRIVATE-BANK-ACCOUNT'); assert.equal(await page.locator('.flow-card').count(), 0, 'hidden values cannot be searched');
  await search.fill('successful'); assert.equal(await page.locator('.flow-card').count(), 1);
  await search.fill('');
  await card.getByRole('button', { name: 'Timeline', exact: true }).click();
  await page.locator('.flow-timeline').getByRole('button', { name: /Sent for processing/ }).click();
  assert.equal(await page.locator('.flow-label-evidence small').count(), 0, 'unchanged labels have no extra status line');
  await page.locator('.flow-timeline').getByRole('button', { name: /Settled/ }).click();
  assert.ok(!(await page.locator('.flow-inspector').innerText()).includes('PRIVATE-BANK-ACCOUNT'));
  await page.getByRole('button', { name: 'Reveal sensitive values', exact: true }).click();
  assert.ok((await page.locator('.flow-label-evidence').innerText()).includes('PRIVATE-BANK-ACCOUNT'));
  assert.ok(!(await page.locator('.flow-detail-heading').innerHTML()).includes('PRIVATE-BANK-ACCOUNT'));
  await page.getByRole('button', { name: 'All flows', exact: true }).click();
  assert.ok(!(await card.innerHTML()).includes('PRIVATE-BANK-ACCOUNT'), 'inspector reveal does not reveal overview');
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1080 });
    for (const locale of ['en', 'de', 'es', 'fr', 'it', 'ja', 'zh-CN']) {
      await page.locator('.precision-settings summary').click();
      await page.locator('#settings-language').selectOption(locale);
      await page.locator('#settings-theme').selectOption(width === 320 ? 'dark' : 'light');
      await page.locator('.precision-settings header button').click();
      for (const [mode, key] of [['detailed', 'flowsDisplayDetailed'], ['condensed', 'flowsDisplayCondensed']]) {
        await page.getByRole('button', { name: translate(locale, key), exact: true }).click();
        assert.equal(await card.locator('.flow-node').count() > 0, mode === 'detailed');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${locale} ${mode} ${width}px`);
      }
    }
    if (process.env.FLOW_LABEL_SCREENSHOTS) { await mkdir(process.env.FLOW_LABEL_SCREENSHOTS, { recursive: true }); await page.screenshot({ path: join(process.env.FLOW_LABEL_SCREENSHOTS, `labels-${width}.png`), fullPage: true }); }
  }
  await page.reload();
  await page.locator('#workspace-tab-flows').click();
  assert.equal(await page.locator('.flow-workspace').getAttribute('data-display'), 'condensed');
  const stored = await page.evaluate(() => Object.values(localStorage).join(' '));
  assert.ok(!stored.includes('PRIVATE-BANK-ACCOUNT') && !stored.includes('successful'));
  assert.deepEqual(errors, []);
  console.log('Flow label browser checks passed: live interpolation, unchanged labels, semantic tones, results, escaping, privacy, density, timeline, keyboard,7 locales,3 widths, persistent preference.');
} finally {
  await browser?.close(); await fixture.close(); await new Promise(resolve => server.close(resolve));
}

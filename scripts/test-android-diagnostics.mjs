// Run after npm run build with node --import tsx. No hardware or inspected-app changes.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createSemanticFlowsFixture } from '../server/fixtures/semantic-flows-ui.mts';
import { androidDiagnosticBundles, androidDiagnosticCases, androidDiagnosticIds, androidDiagnosticNoise } from '../server/fixtures/android-diagnostics.ts';
import { translate } from '../src/i18n/index.ts';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fixture = await createSemanticFlowsFixture(false, 'android');
const archives = new Map(await Promise.all(androidDiagnosticBundles.map(async id => [`/${id}.blueprint`, await readFile(new URL(`../blueprints/bundles/${id}.blueprint`, import.meta.url))])));
const download = createServer((request, response) => { const bytes = archives.get(request.url); response.writeHead(bytes ? 200 : 404); response.end(bytes); });
await new Promise(resolve => download.listen(0, '127.0.0.1', resolve));
const server = await new Promise(resolve => { const listener = fixture.app.listen(0, '127.0.0.1', () => resolve(listener)); });
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  let snapshot = await (await fetch(`${origin}/api/flows/snapshot`)).json();
  const mutate = async (action, body) => {
    const response = await fetch(`${origin}/api/flows/bundles/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Flow-Token': snapshot.token }, body: JSON.stringify(body) });
    assert.equal(response.status, 200, await response.clone().text()); snapshot = await response.json();
  };
  for (const id of androidDiagnosticBundles) {
    await mutate('install', { url: `http://127.0.0.1:${download.address().port}/${id}.blueprint`, scope: 'project' });
    assert.equal(snapshot.sources.find(source => source.id === `project:bundle:${id}`).enabled, false);
    await mutate('activation', { sourceId: `project:bundle:${id}`, enabled: true, revision: snapshot.configRevision });
  }
  assert.ok(androidDiagnosticIds.every(id => snapshot.blueprints.some(bp => bp.id === id)));
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } }); page.setDefaultTimeout(12000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => { localStorage.setItem('uber-device-log.language', 'en'); localStorage.setItem('uber-device-log.lastDevice', 'android:semantic-phone'); });
  await page.goto(origin); await page.locator('#workspace-tab-flows').click();
  let connected = false;
  for (let attempt = 0; attempt < 60; attempt++) { if ((await (await fetch(`${origin}/fixture/state`)).json()).native) { connected = true; break; } await delay(100); }
  assert.ok(connected, 'The real SSE pipeline must be connected before evidence is emitted');
  await page.waitForFunction(() => !document.querySelector('.flow-notice[role="status"]'));
  const cases = androidDiagnosticIds.map(id => androidDiagnosticCases.find(item => item.id === id));
  cases.push(cases[0], androidDiagnosticCases.find(item => item.record.message === 'FATAL EXCEPTION: <img src=x>'));
  for (const record of androidDiagnosticNoise) fixture.emitNative(record);
  for (const { record } of cases) fixture.emitNative(record);
  await page.waitForFunction(count => document.querySelectorAll('.flow-card').length === count, cases.length);
  assert.equal(await page.locator('.flow-card[data-outcome="running"]').count(), 0);
  assert.equal(await page.locator('.flow-card[data-outcome="failed"]').count(), 6);
  assert.equal(await page.locator('.flow-card[data-outcome="completed"]').count(), 5);
  assert.equal(await page.locator('.flow-card img').count(), 0, 'Thread names are text, never executable markup');
  const anr = page.locator('.flow-card').filter({ hasText: '(android-anr)' });
  assert.ok((await anr.innerText()).includes('12042'), 'Display the affected PID extracted from the record');
  assert.ok((await anr.innerText()).includes('Input dispatching timed out'));
  await anr.getByRole('button', { name: 'Timeline', exact: true }).focus(); await page.keyboard.press('Enter');
  await page.locator('.flow-timeline').waitFor(); assert.equal(await page.locator('.flow-timeline .flow-diagram-node').count(), 1);
  await page.locator('.flow-timeline .flow-diagram-node').click();
  await page.getByRole('button', { name: 'Raw log', exact: true }).click();
  await page.getByRole('button', { name: 'Reveal sensitive values', exact: true }).click();
  await page.locator('.flow-inspector pre').filter({ hasText: 'ANR in com.example.game' }).waitFor();
  await page.getByRole('button', { name: 'All flows', exact: true }).click();
  for (const width of [1440, 390, 320]) for (const locale of ['en', 'de', 'es', 'fr', 'it', 'ja', 'zh-CN']) {
    await page.setViewportSize({ width, height: 1080 });
    await page.locator('.precision-settings summary').click(); await page.locator('#settings-language').selectOption(locale);
    await page.locator('#settings-theme').selectOption(width === 320 ? 'dark' : 'light'); await page.locator('.precision-settings header button').click();
    for (const [mode, key] of [['detailed', 'flowsDisplayDetailed'], ['condensed', 'flowsDisplayCondensed'], ['minimal', 'flowsDisplayMinimal']]) {
      await page.getByRole('button', { name: translate(locale, key), exact: true }).click();
      assert.equal(await page.locator('.flow-card').count(), cases.length);
      assert.equal(await page.locator('.flow-card img').count(), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${locale} ${mode} ${width}px`);
      if (mode !== 'minimal') assert.equal(await page.locator('.flow-card[data-outcome="failed"] .flow-badge').first().innerText(), translate(locale, 'flowsStatusFailed'));
    }
    await page.getByRole('button', { name: translate(locale, 'flowsDisplayDetailed'), exact: true }).click();
    if (process.env.SEMANTIC_FLOWS_SCREENSHOTS && locale === 'de') {
      await mkdir(process.env.SEMANTIC_FLOWS_SCREENSHOTS, { recursive: true });
      await page.screenshot({ path: join(process.env.SEMANTIC_FLOWS_SCREENSHOTS, `android-diagnostics-${width}.png`), fullPage: true });
    }
  }
  assert.deepEqual(errors, []);
  console.log('Android diagnostic bundles pass API install/activation, real SSE/worker recognition, repeated single events, outcomes, affected-PID evidence, escaping, keyboard Timeline and seven-language desktop/mobile layouts.');
} finally {
  await browser?.close(); download.closeAllConnections(); await new Promise(resolve => download.close(resolve));
  await fixture.close(); await new Promise(resolve => server.close(resolve));
}

// Run after npm run build. Synthetic names exercise the actual Timeline and Info diagrams.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createSemanticFlowsFixture } from '../server/fixtures/semantic-flows-ui.mts';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fixture = await createSemanticFlowsFixture(false);
const server = await new Promise(resolve => { const listener = fixture.app.listen(0, '127.0.0.1', () => resolve(listener)); });
const url = `http://127.0.0.1:${server.address().port}`;
const names = ['Purchase verification for the very long native store product '.repeat(5), 'Long completion step '.repeat(20)];
const definition = { version: 1, id: 'long-label', name: 'Long graph labels', label: 'Long graph label coverage', start: 'start', timeout: '90s', correlation: { scope: 'device-session', primary: 'id' }, steps: [{ id: 'start', name: names[0], shortLabel: 'S'.repeat(4096), match: { json: { path: 'event', equals: 'long.start' } }, extract: { id: { json: 'id', required: true } }, next: ['done'] }, { id: 'done', name: names[1], match: { json: { path: 'event', equals: 'long.done' } }, outcome: 'completed' }] };
let browser;
try {
  await writeFile(join(fixture.projectDirectory, '.udl/flows', 'long-label.yaml'), JSON.stringify(definition));
  const snapshot = await (await fetch(`${url}/api/flows/snapshot`)).json();
  assert.equal((await fetch(`${url}/api/flows/reload`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Flow-Token': snapshot.token }, body: '{}' })).status, 200);
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { localStorage.setItem('uber-device-log.language', 'en'); localStorage.setItem('uber-device-log.lastDevice', 'ios:semantic-phone'); });
  await page.goto(url); await page.getByRole('tab', { name: /^Flows/ }).click();
  for (let n = 0; n < 60; n++) { if ((await (await fetch(`${url}/fixture/state`)).json()).native) break; await page.waitForTimeout(100); }
  fixture.emit({ event: 'long.start', id: 'long-1' });
  const card = page.locator('.flow-card').filter({ has: page.getByRole('heading', { name: 'Long graph label coverage', exact: true }) });
  await card.getByRole('button', { name: 'Timeline', exact: true }).click();
  async function checkDiagram(label) {
    const nodes = page.locator('.flow-diagram-node');
    assert.equal(await nodes.count(), 2);
    const bounds = await nodes.evaluateAll(items => items.map(item => { const r = item.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height }; }));
    assert.ok(bounds[0].height <= 72 && bounds[1].height <= 72, `${label}: graph nodes respect the reserved node geometry ${JSON.stringify(bounds)}`);
    assert.ok(bounds[0].bottom < bounds[1].top, `${label}: adjacent ranks do not overlap`);
    for (let i = 0; i < 2; i++) assert.equal(await nodes.nth(i).getAttribute('title'), names[i]);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${label}: document fits viewport`);
  }
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1080 });
    await checkDiagram(`Timeline/${width}`);
    await page.getByRole('button', { name: names[0], exact: true }).focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.flow-inspector>h3').innerText(), names[0].trim(), 'full name remains in the selected inspector');
  }
  await page.getByRole('button', { name: 'All flows', exact: true }).click();
  await card.getByRole('button', { name: 'Info', exact: true }).click();
  for (const width of [1440, 390, 320]) { await page.setViewportSize({ width, height: 1080 }); await checkDiagram(`Info/${width}`); }
  assert.deepEqual(errors, []);
  console.log('Long graph label browser checks passed: Timeline/Info, 4096-character short label, full accessible names, keyboard selection and desktop/mobile geometry.');
} finally { await browser?.close(); await fixture.close(); await new Promise(resolve => server.close(resolve)); }

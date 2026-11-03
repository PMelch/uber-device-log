// node --import tsx scripts/test-flow-multi-start.mjs
// Uses fictional events and the actual parser, engine and workspace component.
import assert from 'node:assert/strict';
import { readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { parseFlowBlueprint } from '../shared/flow-blueprints.ts';
import { translate } from '../src/i18n/index.ts';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const filename = `.flow-multi-start-test-${process.pid}.html`;
const parsed = parseFlowBlueprint(await readFile(root + 'test_flow_project/.udl/flows/entry-routes.yaml', 'utf8'));
assert.deepEqual(parsed.diagnostics, []);
let server, browser;
try {
  await writeFile(root + filename, `<div id="precision-design"><div id="app"></div></div><script type="module">
import {createApp, reactive, h} from 'vue';
import '/src/style.css';
import FlowWorkspace from '/src/components/FlowWorkspace.vue';
import {createFlowEngine} from '/shared/flow-engine.ts';
const blueprint = ${JSON.stringify(parsed.blueprint)};
const engine = createFlowEngine(() => Date.now());
engine.setBlueprints([blueprint], 'fixture');
const log = event => ({timestamp: new Date().toISOString(), message: JSON.stringify(event)});
engine.ingest([
 {event:'entry.interactive',operationId:'one',request:{token:'interactive-token',user:'PRIVATE-USER'}},
 {event:'entry.background',operationId:'two',job:{token:'background-token'}},
 {event:'entry.processing',token:'interactive-token'},
 {event:'entry.processing',token:'background-token'}
].map(log));
window.props = reactive({snapshot:{enabled:true,files:[],blueprints:[blueprint],diagnostics:[],revision:'fixture',projectName:'Fixture',directory:'.udl/flows'},instances:engine.getState().instances,locale:'en',activeSources:1,loading:false,gapCount:0});
window.complete = () => {engine.ingest([log({event:'entry.completed',operationId:'one'})]);window.props.instances=engine.getState().instances;};
createApp({render:()=>h(FlowWorkspace,window.props)}).mount('#app');
</script><style>:root{--pl-text:#27382e;--pl-panel:#fff;--pl-line:#789084;--pl-soft:#50645a;--pl-wash:#f2f6f3;--pl-accent:#287653;--pl-accent-bg:#e2f3e8;font-family:Arial}body{margin:20px;background:#f2f6f3}</style>`);
  server = await createServer({ root, server: { host: '127.0.0.1', port: 0 } });
  await server.listen();
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  for (const width of [1800, 390]) for (const locale of ['en', 'es', 'de', 'fr', 'it', 'ja', 'zh-CN']) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(server.resolvedUrls.local[0] + filename);
    await page.locator('.flow-card').last().waitFor();
    const cards = page.locator('.flow-card');
    assert.equal(await cards.count(), 2);
    const interactive = cards.filter({ hasText: 'interactive-token' });
    const background = cards.filter({ hasText: 'background-token' });
    assert.deepEqual(await interactive.locator('.flow-path .flow-node').allTextContents(), ['S1', 'S3', 'S4']);
    assert.deepEqual(await background.locator('.flow-path .flow-node').allTextContents(), ['S2', 'S3', 'S4']);
    assert.ok(!(await interactive.innerText()).includes('PRIVATE-USER'));
    await page.evaluate(locale => window.props.locale = locale, locale);
    await page.waitForFunction(text => document.querySelector('.flow-badge[data-outcome="running"]')?.textContent === text, translate(locale, 'flowsStatusRunning'));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    if (process.env.SEMANTIC_FLOWS_SCREENSHOTS && locale === 'de') {
      await mkdir(process.env.SEMANTIC_FLOWS_SCREENSHOTS, { recursive: true });
      await page.screenshot({ path: `${process.env.SEMANTIC_FLOWS_SCREENSHOTS}/multi-start-overview-${width}.png`, fullPage: true });
    }
    await interactive.locator('.flow-actions button').first().focus();
    await page.keyboard.press('Enter');
    await page.locator('.flow-diagram-node').last().waitFor();
    assert.equal(await page.locator('.flow-diagram-node').count(), 4);
    assert.equal(await page.locator('.flow-diagram-node.is-other[title="Background request"]').count(), 1);
    assert.equal(await page.locator('.flow-diagram path').count(), 3);
    const unused = page.locator('.flow-diagram-node.is-other');
    assert.ok((await unused.getAttribute('aria-label')).includes(translate(locale, 'flowsNotOnRoute')));
    await unused.focus();
    assert.equal(await unused.evaluate(node => node === document.activeElement), true);
    await page.keyboard.press('Enter');
    await page.evaluate(() => window.complete());
    await page.locator('.flow-detail .flow-badge[data-outcome="completed"]').waitFor();
    assert.equal(await page.locator('.flow-detail .flow-status-spinner').count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    if (process.env.SEMANTIC_FLOWS_SCREENSHOTS && locale === 'de') await page.screenshot({ path: `${process.env.SEMANTIC_FLOWS_SCREENSHOTS}/multi-start-timeline-${width}.png`, fullPage: true });
  }
  assert.deepEqual(errors, []);
  console.log('Alternative starts, shared variables, privacy, route classification, status language switching and keyboard navigation pass in all seven locales at desktop/mobile widths.');
} finally {
  await browser?.close();
  await server?.close();
  await rm(root + filename, { force: true });
}

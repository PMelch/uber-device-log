// Synthetic browser regression for the fixed toolbar and overlay workflows.
// Build first. PLAYWRIGHT_MODULE / CHROME_EXECUTABLE match test-log-performance.mjs.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const clients = new Set();
let next = 0, revision = 0, executions = [], sessions = 0;
const consoleState = () => ({ revision, connected: true, contexts: [
 { key: 'top', name: '', url: 'https://app.example.com', frame: 'main', top: true },
 { key: 'frame', name: 'checkout', url: 'https://pay.example.com', frame: 'child', top: false }
] });
function deliver(response, count) {
  response.write(`event: logs\ndata: ${JSON.stringify(Array.from({ length: count }, () => {
    const id = next++;
    return { timestamp: new Date(1760000000000 + id).toISOString(), level: id % 3 === 0 ? 'E' : 'I', tag: 'Checkout', pid: 42,
      message: `Record ${id}: checkout request\n    at example.Checkout.run(Checkout.java:42)` };
  }))}\n\n`);
}
const server = createServer(async (request, response) => {
  if (request.url.startsWith('/api/console')) {
    response.setHeader('Content-Type', 'application/json');
    if (request.method === 'DELETE') { response.writeHead(204); response.end(); return; }
    if (request.method === 'POST') {
      let raw = ''; for await (const chunk of request) raw += chunk;
      if (request.url.endsWith('/execute')) {
        const command = JSON.parse(raw); executions.push(command);
        response.end(JSON.stringify({ revision, elapsed: 12, exception: command.expression === 'missing()', value: command.expression === 'missing()' ? {type:'error',text:'ReferenceError: missing is not defined'} : {type:'object',text:'Object',children:[{name:'answer',value:{type:'number',text:'42'}}]} })); return;
      }
      response.end(JSON.stringify({ id: String(++sessions), ...consoleState() })); return;
    }
    response.end(JSON.stringify(consoleState())); return;
  }
  if (request.url === '/api/devices') {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ devices: [{ id: 'fixture', name: 'Pixel fixture', platform: 'android', state: 'connected', webviews: [
      { id: 'page-a', socket: 'socket', title: 'Customer portal with a deliberately long title', url: 'https://app.example.com/account?token=secret#private' },
      { id: 'page-b', socket: 'socket', title: 'Customer portal with a deliberately long title', url: 'https://app.example.com/checkout' },
      { id: 'page-c', socket: 'socket', title: '', url: 'https://login.example.com/signin?long=hidden' }
    ] }], warnings: [] })); return;
  }
  if (request.url.startsWith('/api/logs?')) {
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    response.write('event: status\ndata: {"code":"streamLive","params":{}}\n\n');
    clients.add(response); deliver(response, 80);
    request.on('close', () => clients.delete(response)); return;
  }
  try {
    const path = resolve(root, '.' + (request.url === '/' ? '/index.html' : request.url.split('?')[0]));
    if (!path.startsWith(root + '/') && path !== root) throw Error('Invalid path');
    response.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : path.endsWith('.svg') ? 'image/svg+xml' : 'text/html');
    response.end(await readFile(path));
  } catch { response.writeHead(404); response.end(); }
});
let browser;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE });
  const errors = [];
  for (const [width, locale] of [1440, 390, 320].flatMap(width => ['en','de','es','fr','it','ja','zh-CN'].map(locale => [width,locale]))) {
    const page = await browser.newPage({ viewport: {width, height: 900}, hasTouch: width < 700 });
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(locale => localStorage.setItem('uber-device-log.language', locale), locale);
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const mobile = width < 700;
    if (mobile) await page.locator('.precision-device summary').click();
    const container = page.locator(mobile ? '.precision-device .precision-menu' : '.device-sidebar-list');
    await container.locator('.webview-select').first().click();
    if (mobile) await page.locator('.precision-device summary').click();
    const trigger = page.locator('.source-console-button').first();
    await trigger.scrollIntoViewIfNeeded();
    const before = await page.locator('.logs').evaluate(el => ({ width: el.offsetWidth, height: el.offsetHeight, y: el.getBoundingClientRect().top + window.scrollY }));
    await trigger.focus();
    const entryHint = page.locator('.source-console-button .feature-status-tooltip:popover-open');
    await entryHint.waitFor();
    assert.ok((await entryHint.innerText()).length > 20);
    const hintBounds = await entryHint.boundingBox();
    assert.ok(hintBounds.x >= 0 && hintBounds.x + hintBounds.width <= width);
    await page.keyboard.press('Escape');
    await entryHint.waitFor({state:'hidden'});
    await trigger.click();
    const panel = page.locator('.js-console'); await panel.waitFor();
    // Initial connection restores editor focus asynchronously. Let it finish
    // before testing keyboard focus on the maturity tooltip.
    await page.waitForFunction(() => document.activeElement === document.querySelector('.js-console textarea'));
    const badge = panel.locator('header .feature-status-badge');
    assert.equal(await badge.getAttribute('data-status'), 'alpha');
    await badge.focus();
    await panel.locator('[role=tooltip]:popover-open').waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await panel.isVisible(), true);
    assert.equal(await panel.locator('[role=tooltip]:popover-open').count(), 0);
    await panel.locator('select').nth(1).selectOption('frame');
    await panel.locator('textarea').fill('window.state');
    await panel.locator('.console-run').click();
    await panel.locator('article').waitFor();
    assert.equal(executions.at(-1).context, 'frame');
    await panel.locator('article summary').click();
    assert.match(await panel.locator('article').innerText(), /answer:.*42/s);
    const after = await page.locator('.logs').evaluate(el => ({ width: el.offsetWidth, height: el.offsetHeight, y: el.getBoundingClientRect().top + window.scrollY })); assert.deepEqual(after, before);
    const count = executions.length;
    revision++;
    await panel.locator('.console-error').waitFor();
    assert.equal(await panel.locator('.console-run').isDisabled(), true);
    assert.equal(executions.length, count);
    if (locale === 'en') {
      await page.locator('#settings-language').evaluate(el => { el.value = 'de'; el.dispatchEvent(new Event('change', { bubbles: true })); });
      assert.match(await panel.locator('.console-error').innerText(), /Seite oder Frame/);
      await page.locator('#settings-language').evaluate(el => { el.value = 'en'; el.dispatchEvent(new Event('change', { bubbles: true })); });
    }
    assert.ok(clients.size > 0);
    for (const client of clients) deliver(client, 1);
    await panel.locator('select').nth(1).selectOption('top');
    await panel.locator('textarea').fill('missing()');
    await panel.locator('textarea').press('Control+Enter');
    await panel.locator('.console-exception').waitFor();
    assert.equal(executions.at(-1).context, 'top');
    assert.equal(await panel.evaluate(el => el.scrollWidth <= el.clientWidth), true);
    assert.equal(await panel.locator('footer').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    if (width === 1440 && locale === 'en' || width === 320 && locale === 'de') await page.screenshot({ path: `/tmp/console-${width}-${locale}.png` });
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    assert.equal(await panel.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(28, 30, 36)');
    assert.equal(await badge.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(59, 48, 29)');
    await page.keyboard.press('Escape');
    await panel.waitFor({state:'detached'});
    assert.equal(await trigger.evaluate(el => el === document.activeElement), true);
    await page.close();
    console.log(`Console UI: ${width}px ${locale} passed`);
  }
  assert.deepEqual(errors, []);
  // Real Chromium protocol test: a frame's window must differ from its parent's window.
  const { RuntimeConsole } = await import('../build/server/runtime-console.js');
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.setContent('<iframe name="child" srcdoc="<title>Frame title</title>"></iframe>');
  const cdp = await page.context().newCDPSession(page);
  const runtime = new RuntimeConsole('android');
  for (const method of ['Runtime.executionContextCreated','Runtime.executionContextDestroyed','Runtime.executionContextsCleared','Page.frameNavigated','Page.frameDetached']) cdp.on(method, params => runtime.receive({method,params}));
  runtime.attach('', packet => { cdp.send(packet.method, packet.params).then(result => runtime.receive({id:packet.id,result}), error => runtime.receive({id:packet.id,error:{message:error.message}})); });
  await runtime.enable();
  const contexts = runtime.state().contexts;
  assert.equal(contexts.length, 2);
  const child = contexts.find(c => !c.top);
  assert.ok(child);
  const result = await runtime.evaluate(child.key, runtime.revision, '({title: document.title, same: window === top, get untouched() { throw new Error("getter called") }})');
  assert.equal(result.value.children.find(p => p.name === 'title').value.text, '"Frame title"');
  assert.equal(result.value.children.find(p => p.name === 'same').value.text, 'false');
  assert.equal(result.value.children.find(p => p.name === 'untouched').value.type, 'accessor');
  const old = runtime.revision;
  await page.reload();
  await assert.rejects(runtime.evaluate(child.key, old, '1'), /consoleStale/);
  runtime.close(); await page.close();
  console.log('Real Chromium iframe execution, getter preservation and navigation passed');
} finally { await browser?.close(); for (const client of clients) client.end(); server.close(); }

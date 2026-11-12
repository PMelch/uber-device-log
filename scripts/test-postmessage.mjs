// postMessage UI regression plus real cross-origin Window messaging through CDP.
// Build first. PLAYWRIGHT_MODULE / CHROME_EXECUTABLE match test-log-performance.mjs.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const clients = new Set();
const captures = new Map();
let next = 0, revision = 0, executions = [], sessions = 0;
let connectionDelay = 0;
let executionDelay = 0, clearDelay = 0;
const frameUrl = 'https://pay.example.com/' + 'checkout/'.repeat(40) + '?token=private-query#payment-step';
const consoleState = () => ({ revision, connected: true, contexts: [
 { key: `top-${revision}`, name: '', url: 'https://app.example.com', frame: 'main', top: true, depth: 0 },
 { key: `frame-${revision}`, name: 'checkout', url: frameUrl, frame: 'child', top: false, depth: 1 }
] });
function deliver(response, count) {
  response.write(`event: logs\ndata: ${JSON.stringify(Array.from({ length: count }, () => {
    const id = next++;
    return { timestamp: new Date(1760000000000 + id).toISOString(), level: id % 3 === 0 ? 'E' : 'I', tag: 'Checkout', pid: 42,
      message: `Record ${id}: checkout request\n    at example.Checkout.run(Checkout.java:42)` };
  }))}\n\n`);
}
const server = createServer(async (request, response) => {
  if (request.url.endsWith('/messages')) {
    const id = request.url.split('/')[3];
    response.setHeader('Content-Type', 'application/json');
    if (request.method === 'POST') captures.set(id, { active: true, revision, sent: false });
    const capture = captures.get(id) ?? { active: false, revision, sent: true };
    const records = capture.active && !capture.sent ? [{ id: 1, time: Date.now(), source: `top-${capture.revision}`, receiver: `frame-${capture.revision}`, origin: 'https://app.example.com', data: '{"message":"hello-cross-origin"}' }] : [];
    if (request.method !== 'POST') capture.sent = true;
    if (request.method === 'DELETE' || capture.revision !== revision) capture.active = false;
    response.end(JSON.stringify({ ...capture, contexts: [`top-${capture.revision}`, `frame-${capture.revision}`], unavailable: [], records: request.method === 'POST' ? [] : records, dropped: 0 })); return;
  }
  if (request.url.startsWith('/api/console')) {
    response.setHeader('Content-Type', 'application/json');
    if (request.method === 'DELETE') { if (request.url.endsWith('/results') && clearDelay) await new Promise(resolve => setTimeout(resolve, clearDelay)); response.writeHead(204); response.end(); return; }
    if (request.method === 'POST') {
      let raw = ''; for await (const chunk of request) raw += chunk;
      if (request.url.endsWith('/properties')) {
        const { handle, offset } = JSON.parse(raw);
        const children = handle === 'nested-object' ? [{ name: 'deepValue', value: { type: 'number', text: '99' } }] :
          offset === 0 ? [{name:'nested', value:{type:'object',text:'Object',handle:'nested-object'}}, ...Array.from({length:49}, (_,i) => ({name:`field${i}`,value:{type:'number',text:String(i)}}))] : [{name:'lastField',value:{type:'string',text:'"complete"'}}];
        response.end(JSON.stringify({ children, revision, total: handle === 'nested-object' ? 1 : 51, ...(handle !== 'nested-object' && offset === 0 ? {nextOffset:50} : {}) })); return;
      }
      if (request.url.endsWith('/execute')) {
        const command = JSON.parse(raw); executions.push(command);
        if (executionDelay) await new Promise(resolve => setTimeout(resolve, executionDelay));
        response.end(JSON.stringify({ revision, elapsed: 12, exception: command.expression === 'missing()', value: command.expression === 'missing()' ? {type:'error',text:'ReferenceError: missing is not defined'} : {type:'object',text:'Object',handle:'root-object',truncated:true,children:[{name:'answer',value:{type:'number',text:'42'}}]} })); return;
      }
      if (connectionDelay) await new Promise(resolve => setTimeout(resolve, connectionDelay));
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
  for (const width of [1440, 390, 320]) for (const locale of ['en','de','es','fr','it','ja','zh-CN']) {
    console.log(`Checking main log ${width} ${locale}`);
    revision = 0;
    const page = await browser.newPage({ viewport: { width, height: 900 }, acceptDownloads: true });
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(locale => localStorage.setItem('uber-device-log.language', locale), locale);
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const mobile = width < 700;
    if (mobile) await page.locator('.precision-device summary').click();
    await page.locator(mobile ? '.precision-device .webview-select' : '.device-sidebar-list .webview-select').first().click();
    if (mobile) await page.locator('.precision-device summary').click();
    const main = page.locator('#workspace-logs');
    const choices = page.locator('.precision-source-choice');
    const messageChoice = choices.filter({ hasText: 'postMessage' }).locator('input');
    const webviewChoice = choices.nth(1).locator('input');
    const nativeChoice = choices.first().locator('input');
    const setChoice = async (input, checked) => { if (await input.isChecked() !== checked) await input.locator('..').click(); };
    const rawRows = main.locator('.precision-row');
    await rawRows.first().waitFor();
    await setChoice(messageChoice, true);
    const mainMonitor = main.locator('.message-log');
    const row = rawRows.filter({ hasText: 'hello-cross-origin' });
    await row.waitFor();
    assert.ok(await rawRows.count() > 1, 'messages and raw logs share the main viewport');
    await setChoice(nativeChoice, true);
    assert.equal(await webviewChoice.isChecked(), true);
    assert.equal(await messageChoice.isChecked(), true);
    const sessionCount = sessions;
    await setChoice(messageChoice, false);
    await row.waitFor({ state: 'detached' });
    assert.equal(await mainMonitor.isVisible(), false);
    const hiddenPoll = await page.waitForResponse(response => response.request().method() === 'GET' && response.url().endsWith('/messages'));
    assert.equal((await hiddenPoll.json()).active, true, 'hidden capture keeps polling');
    assert.equal(clients.size, 2, 'hiding sources does not restart or close raw streams');
    await setChoice(webviewChoice, false);
    await setChoice(messageChoice, true);
    await row.waitFor();
    assert.equal(sessions, sessionCount, 'display toggles retain the capture session');
    await setChoice(nativeChoice, false);
    assert.equal(await rawRows.count(), 1, 'postMessage can be displayed on its own');
    await main.locator('.precision-pause').click();
    await main.locator('.precision-pause').click();
    await main.locator('.precision-commandbar .overlay-trigger').click();
    await page.locator('#command-export-format').selectOption('json');
    const exportedDownload = page.waitForEvent('download');
    await page.locator('.command-popover .command-group').first().locator('button').click();
    const exported = JSON.parse(await readFile(await (await exportedDownload).path(), 'utf8'));
    assert.equal(exported.entries.length, 1);
    assert.equal(exported.entries[0].postMessage.receiver, 'frame-0');
    assert.equal(exported.sources[0].kind, 'postMessage');
    assert.equal(exported.entries[0].postMessage.receiverContext.url, frameUrl);
    await messageChoice.focus();
    assert.ok(await messageChoice.evaluate(el => el === document.activeElement));
    for (const element of [page.locator('.precision-source-choices'), mainMonitor]) {
      const bounds = await element.boundingBox();
      assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1, JSON.stringify({ width, locale, bounds }));
    }
    if (locale === 'de') await page.screenshot({ path: `/tmp/postmessage-main-${width}.png` });
    await setChoice(webviewChoice, true);
    await page.locator('.source-console-button').first().click();
    await page.locator('.console-mode button').nth(1).click();
    const monitor = page.locator('.js-console .message-log'); await monitor.waitFor();
    await monitor.locator('select').nth(0).selectOption('top-0');
    await monitor.locator('.actions button').nth(0).click();
    await monitor.locator('article').waitFor();
    assert.equal(await monitor.locator('article').count(), 1);
    await monitor.locator('select').nth(1).selectOption('in');
    assert.equal(await monitor.locator('article').count(), 0);
    await monitor.locator('select').nth(1).selectOption('out');
    assert.equal(await monitor.locator('article').count(), 1);
    await monitor.locator('summary').click();
    assert.match(await monitor.locator('pre').innerText(), /hello-cross-origin/);
    await monitor.locator('input').fill('no-match');
    assert.equal(await monitor.locator('article').count(), 0);
    await monitor.locator('input').fill('');
    await monitor.locator('.actions button').nth(1).click();
    revision++;
    await page.waitForFunction(() => document.querySelector('.js-console .message-log select option[value="top-1"]'));
    await page.waitForFunction(() => document.querySelector('.js-console .message-log .actions button')?.disabled);
    assert.equal(await monitor.locator('article').count(), 1, 'navigation preserves paused historical view');
    assert.equal(await monitor.locator('select').nth(0).inputValue(), 'top-0');
    const download = page.waitForEvent('download');
    await monitor.locator('.actions button').nth(3).click();
    assert.equal((await download).suggestedFilename(), 'postmessage.json');
    if (locale === 'de') {
      await page.locator('#settings-language').evaluate(el => { el.value = 'ja'; el.dispatchEvent(new Event('change', { bubbles: true })); });
      await page.waitForFunction(() => document.querySelector('.js-console .message-log h3')?.textContent.includes('ログ'));
      assert.equal(await monitor.locator('article').count(), 1);
      await page.locator('#settings-language').evaluate(el => { el.value = 'de'; el.dispatchEvent(new Event('change', { bubbles: true })); });
      await page.waitForFunction(() => document.querySelector('.js-console .message-log h3')?.textContent.includes('Log'));
    }
    const bounds = await monitor.boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1, JSON.stringify({ width, locale, bounds }));
    assert.equal(await monitor.evaluate(el => el.scrollWidth <= el.clientWidth), true);
    await monitor.locator('select').nth(0).focus(); assert.equal(await monitor.locator('select').nth(0).evaluate(el => document.activeElement === el), true);
    if (locale === 'de' && [1440, 390].includes(width)) await page.screenshot({ path: `/tmp/postmessage-${width}.png` });
    await monitor.locator('.actions button').nth(2).click(); assert.equal(await monitor.locator('article').count(), 0);
    await monitor.locator('select').nth(0).selectOption('top-1');
    await page.route('**/api/console/*/messages', route => route.fulfill({ status: 409, contentType: 'application/json', body: '{"code":"consoleUnavailable"}' }));
    await monitor.locator('.actions button').nth(0).click();
    await monitor.locator('[role="alert"]').waitFor();
    if (locale === 'de') {
      const before = await monitor.locator('[role="alert"]').innerText();
      await page.locator('#settings-language').evaluate(el => { el.value = 'ja'; el.dispatchEvent(new Event('change', { bubbles: true })); });
      await page.waitForFunction(before => document.querySelector('.js-console .message-log [role="alert"]')?.textContent !== before, before);
      await page.locator('#settings-theme').evaluate(el => { el.value = 'dark'; el.dispatchEvent(new Event('change', { bubbles: true })); });
      await page.screenshot({ path: `/tmp/postmessage-dark-${width}.png` });
    }
    await page.unroute('**/api/console/*/messages');
    await page.locator('.js-console header button').last().click();
    const startCapture = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/messages'));
    await mainMonitor.locator('.actions button').first().click();
    const sessionUrl = (await startCapture).url().replace(/\/messages$/, '');
    const released = page.waitForResponse(response => response.request().method() === 'DELETE' && response.url() === sessionUrl);
    await page.locator('.precision-disconnect:visible').click();
    await mainMonitor.waitFor({ state: 'detached' });
    assert.ok((await released).ok(), 'disconnect releases the main console session');
    assert.equal(await messageChoice.isChecked(), true, 'disconnected records retain postMessage source identity');
    assert.equal(await page.locator('.source-filters').filter({ hasText: 'postMessage' }).locator('.source-console-button').count(), 0);
    await setChoice(messageChoice, false);
    await setChoice(messageChoice, true);
    assert.equal(await messageChoice.isChecked(), true, 'retained sources can be hidden and restored after disconnect');
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log('postMessage UI: 21 viewport/locale combinations passed');

  // Different ports are different origins. Exercise the real injected listener,
  // not a mock event, including payloads and source WindowProxy correlation.
  const { RuntimeConsole } = await import('../build/server/runtime-console.js');
  const childServer = createServer((_req, res) => res.end('<!doctype html><title>Cross-origin child</title>'));
  await new Promise(resolve => childServer.listen(0, '127.0.0.1', resolve));
  const parentServer = createServer((_req, res) => res.end(`<!doctype html><iframe src="http://127.0.0.1:${childServer.address().port}"></iframe>`));
  await new Promise(resolve => parentServer.listen(0, '127.0.0.1', resolve));
  const page = await browser.newPage(); const runtime = new RuntimeConsole('android');
  let monitor;
  try {
    await page.goto(`http://127.0.0.1:${parentServer.address().port}`);
    const cdp = await page.context().newCDPSession(page);
    for (const method of ['Runtime.executionContextCreated', 'Runtime.executionContextDestroyed', 'Runtime.executionContextsCleared', 'Page.frameNavigated', 'Page.frameDetached']) cdp.on(method, params => runtime.receive({ method, params }, 'page'));
    runtime.attach('page', packet => { void cdp.send(packet.method, packet.params).then(result => runtime.receive({ id: packet.id, result }, 'page'), error => runtime.receive({ id: packet.id, error: { message: error.message } }, 'page')); });
    await runtime.enable(); assert.equal(runtime.state().contexts.length, 2);
    monitor = runtime.createMessageMonitor('browser-test');
    assert.equal((await monitor.start(runtime.revision)).contexts.length, 2);
    await page.evaluate(() => { frames[0].postMessage({ greeting: 'cross-origin', values: [1, 2] }, '*'); });
    await page.waitForTimeout(50);
    const captured = await monitor.poll();
    assert.equal(captured.records.length, 1);
    assert.equal(captured.records[0].source, runtime.state().contexts.find(c => c.top).key);
    assert.notEqual(captured.records[0].receiver, captured.records[0].source);
    assert.deepEqual(JSON.parse(captured.records[0].data), { greeting: 'cross-origin', values: [1, 2] });
    await page.frames()[1].evaluate(() => parent.postMessage('reply', '*'));
    await page.waitForTimeout(50);
    const final = await monitor.finish(); assert.equal(final.records.length, 1); assert.equal(final.active, false);
    console.log('Real cross-origin CDP capture and final drain passed');
  } finally { await monitor?.stop(); runtime.close(); await page.close(); parentServer.closeAllConnections(); parentServer.close(); childServer.closeAllConnections(); childServer.close(); }
} finally {
  await browser?.close(); for (const client of clients) client.end(); server.closeAllConnections(); server.close();
}

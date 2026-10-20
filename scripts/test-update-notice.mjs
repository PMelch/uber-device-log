// Build first; uses a local HTTP fixture, no registry or device requests.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../dist/', import.meta.url));
let version = '1.1.0';
const server = createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/api/update') return res.end(JSON.stringify({status:'available',currentVersion:'1.0.0',latestVersion:version,installation:'npx',commands:['npx uber-device-log@latest'],changelogUrl:'https://example.test/changelog'}));
  if (req.url === '/api/devices') return res.end(JSON.stringify({devices:[],warnings:[]}));
  try {
    const path = resolve(root, '.' + (req.url === '/' ? '/index.html' : req.url.split('?')[0]));
    if (!path.startsWith(root)) throw Error('path');
    res.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(await readFile(path));
  } catch { res.writeHead(404); res.end(); }
});
let browser;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({headless:true, executablePath:process.env.CHROME_EXECUTABLE});
  const errors = [];
  for (const width of [1440,390,320]) for (const locale of ['en','de','es','fr','it','ja','zh-CN']) {
    version = '1.1.0';
    const page = await browser.newPage({viewport:{width,height:900}});
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(locale => localStorage.setItem('uber-device-log.language',locale), locale);
    await page.goto('http://127.0.0.1:' + server.address().port);
    const notice = page.locator('.update-notice');
    const actions = page.locator('.update-notice-actions button');
    await actions.first().waitFor();
    assert.equal(await actions.count(),2);
    assert.equal(await page.locator('.update-notice pre').innerText(),'npx uber-device-log@latest');
    const box = await page.locator('.update-notice-panel').boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width + 1);
    for (const button of await actions.all()) {
      const b = await button.boundingBox(); assert.ok(b.x >= 0 && b.x+b.width <= width+1);
    }
    if (locale === 'de' && width !== 320) await page.screenshot({path:'/tmp/update-actions-' + width + '.png'});
    await notice.locator('summary').focus();
    await page.keyboard.press('Escape');
    assert.equal(await notice.getAttribute('open'),null);
    await notice.locator('summary').click();
    await actions.first().focus(); await page.keyboard.press('Enter');
    await notice.waitFor({state:'detached'});
    assert.equal(await page.locator('.precision-settings summary').evaluate(el=>el===document.activeElement),true);
    await page.reload(); await page.waitForLoadState('networkidle');
    assert.equal(await notice.count(),0);
    // Expiry is reevaluated reactively in an already-open application on focus.
    await page.evaluate(() => {
      const key='uber-device-log.update.1.1.0';
      const until=JSON.parse(localStorage.getItem(key)).until;
      Date.now=()=>until;
      window.dispatchEvent(new Event('focus'));
    });
    await actions.last().waitFor();
    await actions.last().click(); await notice.waitFor({state:'detached'});
    await page.reload(); await page.waitForLoadState('networkidle');
    assert.equal(await notice.count(),0);
    version='1.2.0'; await page.reload(); await actions.first().waitFor();
    assert.match(await notice.innerText(),/1.2.0/);
    await page.close();
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: update actions, persistence, reactive expiry, newer releases, keyboard focus and layout in 21 desktop/mobile locale cases');
} finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); }

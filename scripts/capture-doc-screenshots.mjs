// Build the app first. Uses the actual UI with fictional device/log fixtures only.
// PLAYWRIGHT_MODULE and CHROME_EXECUTABLE match the browser regression scripts.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const output = fileURLToPath(new URL('../docs/images/', import.meta.url));
const view = { id: 'checkout-demo', socket: 'webview_devtools_remote_2418', title: 'Checkout', url: 'https://shop.example.com/checkout?session=demo' };
const devices = [
  { id: 'demo-pixel', name: 'Pixel 9 Pro XL', platform: 'android', state: 'connected', webviews: [view] },
  { id: 'demo-iphone', name: 'iPhone 16 Pro', platform: 'ios', state: 'connected', webviews: [{ ...view, socket: 'page-1' }] },
];
const messages = [
 ['I','Checkout','Checkout session started · cart items: 3'],
 ['D','Checkout','Checkout bridge ready · native payment handler registered'],
 ['I','Checkout','Checkout request GET /api/cart → 200 (48 ms)'],
 ['I','Checkout','Checkout totals updated · EUR 129.00'],
 ['W','Checkout','Checkout image cache miss · using network fallback'],
 ['I','Checkout','Checkout payment sheet opened'],
 ['D','Checkout','Checkout lifecycle resumed · restoring form state'],
 ['W','Checkout','Checkout request took 840 ms · retry available'],
 ['E','Checkout','readFile /data/user/0/com.example.shop/files/checkout/cart.json failed: java.io.FileNotFoundException: /data/user/0/com.example.shop/files/checkout/cart.json: open failed: ENOENT (No such file or directory)'],
 ['I','Checkout','Checkout recovered · fresh cart received'],
 ['I','Checkout','Checkout payment authorized · demo reference PAY-2048'],
 ['I','Checkout','Checkout complete · confirmation displayed'],
];
const clients = new Set();
const server = createServer(async (request,response) => {
 if(request.url === '/api/devices') {response.setHeader('Content-Type','application/json');response.end(JSON.stringify({devices,warnings:[]}));return;}
 if(request.url.startsWith('/api/logs?')) {
  const web = request.url.includes('webview');
  response.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});
  response.write('event: status\ndata: {"code":"streamLive","params":{}}\n\n');
  response.write(`event: logs\ndata: ${JSON.stringify(messages.map(([level,tag,message],i)=>({timestamp:new Date(Date.UTC(2026,9,19,10,42,i*2,web?350:0)).toISOString(),level,tag:web?'console':tag,pid:web?2418:1936,message:web?(i===8?'Uncaught TypeError: Cannot read properties of undefined (reading \'total\')\n    at updateCheckout (https://shop.example.com/app.js:284:17)':`[checkout] ${message.replace(/^Checkout /,'')}`):message})))}\n\n`);
  clients.add(response);request.on('close',()=>clients.delete(response));return;
 }
 try {
  const path=resolve(root,'.'+(request.url==='/'?'/index.html':request.url.split('?')[0]));
  if(!path.startsWith(root+'/'))throw Error('Invalid path');
  response.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.svg')?'image/svg+xml':'text/html');
  response.end(await readFile(path));
 }catch {response.writeHead(404);response.end();}
});
let browser;
try {
 await mkdir(output,{recursive:true});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
 const page=await browser.newPage({viewport:{width:1440,height:1050},colorScheme:'light',deviceScaleFactor:1});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{localStorage.setItem('uber-device-log.language','en');localStorage.setItem('uber-device-log.lastDevice','android:demo-pixel');});
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.waitForSelector('.entry');
 await page.locator('.precision-source-choice').nth(1).click();
 await page.waitForFunction(()=>document.querySelectorAll('.source-filters').length===2);
 await page.locator('.source-filters .overlay-trigger').first().click();
 await page.locator('.precision-overlay:popover-open input[type=search]').fill('checkout');
 await page.locator('.precision-overlay:popover-open .overlay-heading button').click();
 await page.locator('.stream-title').click();
 await page.waitForTimeout(400);
 await page.locator('#precision-design').screenshot({path:resolve(output,'log-viewer.png'),animations:'disabled'});
 // Show a native error's actual detail panel, including the pinned state.
 await page.setViewportSize({width:1440,height:1800});
 await page.locator('.entry').filter({hasText:'FileNotFoundException'}).first().locator('.precision-detail-trigger').click();
 await page.locator('#log-message-details').waitFor();
 await page.locator('#log-message-details').screenshot({path:resolve(output,'message-details.png'),animations:'disabled'});
 await page.keyboard.press('Escape');
 await page.locator('.precision-settings summary').click();
 await page.locator('.settings-panel').screenshot({path:resolve(output,'settings.png'),animations:'disabled'});
 await page.locator('.settings-panel header button').click();
 await page.setViewportSize({width:1440,height:1050});
 await page.locator('.device-sidebar-list .webview-select').nth(1).click();
 await page.waitForFunction(()=>document.querySelectorAll('.source-filters').length===1 && document.querySelector('.stream-title')?.textContent==='WebView console');
 await page.waitForSelector('.entry');
 await page.waitForTimeout(400);
 await page.locator('#precision-design').screenshot({path:resolve(output,'webview-console.png'),animations:'disabled'});
 if(errors.length)throw Error(errors.join('\n'));
 console.log('Updated four documentation screenshots from the current app.');
} finally {await browser?.close();for(const client of clients)client.end();server.close();}

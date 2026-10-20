// Build first. This fixture verifies UI behavior without USB hardware or Google requests.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const requests = [];
const pageTarget = { id:'page',socket:'webview_devtools_remote_42',title:'Account settings – a deliberately long page title',url:'https://example.test/account?original=value' };
const devices = [
  {id:'pixel',name:'Pixel test phone',platform:'android',state:'connected',webviews:[pageTarget,{...pageTarget,id:'checkout',title:'Checkout',url:'https://example.test/checkout'}]},
  {id:'iphone',name:'iPhone test device',platform:'ios',state:'connected',webviews:[{...pageTarget,id:'ios-page',socket:'PID:42'}]},
];
const inspectorUrl = 'https://chrome-devtools-frontend.appspot.com/serve_rev/@fixture/inspector.html?ws=127.0.0.1:12345/secret';
const server = createServer(async (request,response) => {
  response.setHeader('Content-Type','application/json');
  if(request.url==='/api/devices') {response.end(JSON.stringify({devices,warnings:[]}));return;}
  if(request.url==='/api/inspector') {let raw='';for await(const part of request) raw+=part;requests.push(JSON.parse(raw));response.end(JSON.stringify({url:inspectorUrl}));return;}
  if(request.url.startsWith('/api/console')) {response.end(JSON.stringify({id:'session',revision:0,connected:true,contexts:[{key:'top',name:'',url:pageTarget.url,frame:'main',top:true}]}));return;}
  if(request.url.startsWith('/api/logs?')) {response.writeHead(200,{'Content-Type':'text/event-stream'});response.write('event: status\ndata: {"code":"streamLive","params":{}}\n\n');return;}
  try {const path=resolve(root,'.'+(request.url==='/'?'/index.html':request.url.split('?')[0]));if(!path.startsWith(root+'/'))throw Error();response.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.svg')?'image/svg+xml':'text/html');response.end(await readFile(path));}
  catch {response.writeHead(404);response.end();}
});
let browser;
try {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});
  const errors=[];
  let tested=0;
  for(const width of [1440,390,320]) for(const locale of ['en','de','es','fr','it','ja','zh-CN']) for(const theme of ['light','dark']) {
    if(process.env.INSPECTOR_CASE && process.env.INSPECTOR_CASE!==`${width}:${locale}:${theme}`) continue;
    const page=await browser.newPage({viewport:{width,height:900}});
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(({locale,theme})=>{
      localStorage.setItem('uber-device-log.language',locale);
      localStorage.setItem('uber-device-log.theme',theme);
      window.__inspector={blocked:false,copyDenied:false,opened:0,navigated:[],copied:[]};
      window.open=()=>{window.__inspector.opened++;return window.__inspector.blocked?null:{opener:null,closed:false,close(){this.closed=true;},location:{replace(url){window.__inspector.navigated.push(url);}}};};
      Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{if(window.__inspector.copyDenied)throw Error('denied');window.__inspector.copied.push(text);}}});
    },{locale,theme});
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    async function choose(index) {
      if(width<700) await page.locator('.precision-device summary').click();
      await page.locator(width<700?'.precision-device .webview-select':'.device-sidebar-list .webview-select').nth(index).click();
      if(width<700) await page.locator('.precision-device details').evaluate(el=>{if(el.open)el.open=false;});
    }
    await choose(0);
    const trigger=page.locator('.source-filters .inspector-trigger').first();
    const row=page.locator('.source-filter-main').first();
    assert.ok((await trigger.innerText()).trim().length > 0, 'Inspect action has a visible label');
    const styleOf = element => { const style = getComputedStyle(element); return { border: style.border, radius: style.borderRadius, height: style.height, background: style.backgroundColor }; };
    assert.deepEqual(await trigger.evaluate(styleOf), await row.locator('.source-console-button').evaluate(styleOf), 'Inspect uses the console button frame');
    const before=await row.boundingBox();
    if(locale==='de'&&theme==='dark'&&width===390) await page.screenshot({path:'/tmp/inspector-labeled-mobile.png'});
    if(locale==='en'&&theme==='light'&&width===1440) await page.screenshot({path:'/tmp/inspector-labeled-desktop.png'});
    await trigger.click();
    const dialog=page.locator('.inspector-dialog');await dialog.waitFor();
    assert.deepEqual(requests.at(-1),{platform:'android',id:'pixel',socket:pageTarget.socket,target:'page'});
    assert.deepEqual(await page.evaluate(()=>window.__inspector.navigated),[inspectorUrl]);
    assert.equal(await dialog.locator('textarea').inputValue(),inspectorUrl);
    await dialog.locator('.inspector-copy').click();
    assert.equal(await page.evaluate(()=>window.__inspector.copied.at(-1)),inspectorUrl);
    const box=await dialog.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width+1);assert.ok(box.y>=0&&box.y+box.height<=901);
    await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
    assert.equal(await trigger.evaluate(el=>el===document.activeElement),true);
    assert.deepEqual(await row.boundingBox(),before);
    await page.evaluate(()=>{window.__inspector.blocked=true;window.__inspector.copyDenied=true;});
    await trigger.click();await dialog.waitFor();assert.equal(await dialog.locator('[role=alert]').count(),1);
    await dialog.locator('.inspector-copy').click();assert.equal(await dialog.locator('[role=status]').count(),1);
    await dialog.locator('textarea').focus();assert.equal(await dialog.locator('textarea').evaluate(el=>el.selectionEnd-el.selectionStart),inspectorUrl.length);
    await page.keyboard.press('Escape');
    await choose(2);
    const safari=page.locator('.source-filters .inspector-trigger').last();
    const opens=await page.evaluate(()=>window.__inspector.opened);
    await safari.click();await dialog.waitFor();
    const details=await dialog.locator('textarea').inputValue();assert.match(details,/iPhone test device/);assert.match(details,/PID:42/);assert.match(details,/original=value/);
    if(locale==='de'&&((width===1440&&theme==='light')||(width===390&&theme==='dark'))) await page.screenshot({path:width===1440?'/tmp/inspector-safari-desktop.png':'/tmp/inspector-safari-mobile.png'});
    assert.equal(await dialog.locator('li').count(),2);assert.equal(await page.evaluate(()=>window.__inspector.opened),opens);
    await page.keyboard.press('Escape');assert.equal(await safari.evaluate(el=>el===document.activeElement),true);
    if(locale==='de'&&width===390&&theme==='dark') await page.screenshot({path:'/tmp/inspector-source-mobile.png'});
    await page.locator('.source-console-button').last().click();
    const consolePanel=page.locator('.js-console');await consolePanel.waitFor();
    await consolePanel.locator('.inspector-trigger').click();await dialog.waitFor();
    await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert.equal(await consolePanel.isVisible(),true);
    assert.equal(await consolePanel.locator('.inspector-trigger').evaluate(el=>el===document.activeElement),true);
    await consolePanel.locator('select').first().selectOption({index:0});
    await consolePanel.locator('.inspector-trigger').click();await dialog.waitFor();assert.equal(requests.at(-1).id,'pixel');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.close();tested++;
  }
  assert.deepEqual(errors,[]);
  console.log(`Inspector UI passed: ${tested} locale/width/theme combinations, exact targets, blocked tabs, copy fallback, Safari guidance and nested keyboard focus.`);
} finally {await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}

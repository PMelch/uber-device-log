// Run after npm run build. Synthetic data only; no device or business operation.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createSemanticFlowsFixture } from '../server/fixtures/semantic-flows-ui.mts';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fixture = await createSemanticFlowsFixture(false);
const server = await new Promise(resolve => { const listener = fixture.app.listen(0, '127.0.0.1', () => resolve(listener)); });
const url = `http://127.0.0.1:${server.address().port}`;
const definition = level => ({ version: 1, id: `priority-${level}`, name: `Priority fixture ${level}`, ...(level ? { priority: level } : {}), label: [{ text: `Flow ${level || 'default'}` }, ...['success','error','warning','info'].map(tone=>({text:` · ${tone}`,tone}))], start: 'done', timeout: '90s', correlation: { scope: 'device-session', primary: 'id' }, steps: [{ id: 'done', name: 'Observed', match: { json: { path: 'event', equals: `priority.${level}` } }, extract: { id: { json: 'id', required: true }, result: { json: 'result', result: true } }, outcome: 'completed' }] });
let browser;
try {
  for (const level of [0,1,2,3,4,5]) await writeFile(join(fixture.projectDirectory, '.udl/flows', `priority-${level}.yaml`), '# evidence comment\n' + JSON.stringify(definition(level)));
  const snapshot = await (await fetch(`${url}/api/flows/snapshot`)).json();
  const reloaded = await fetch(`${url}/api/flows/reload`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Flow-Token': snapshot.token }, body: '{}' });
  assert.equal(reloaded.status, 200);
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } }); const errors=[]; page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(12000);
  await page.addInitScript(()=>{localStorage.setItem('uber-device-log.language','en');localStorage.setItem('uber-device-log.lastDevice','ios:semantic-phone');});
  await page.goto(url);await page.getByRole('tab',{name:/^Flows/}).click();
  for(let n=0;n<60;n++){if((await(await fetch(`${url}/fixture/state`)).json()).native)break;await page.waitForTimeout(100);}
  for(const level of [0,1,2,3,4,5])fixture.emit({event:`priority.${level}`,id:`id-${level}`,result:42});
  await page.getByRole('heading',{name:/^Flow 5/}).waitFor();
  assert.equal(await page.locator('.flow-card').count(),6);
  assert.equal(await page.locator('.flow-card[data-priority="3"]').count(),2,'missing priority defaults to 3');
  await page.locator('.flow-priority-legend summary').click();assert.equal(await page.locator('.flow-priority-legend i').count(),5);
  const palettes={};
  for(const theme of ['light','dark']){
    await page.locator('.precision-settings summary').click();await page.locator('#settings-theme').selectOption(theme);await page.locator('.precision-settings header button').click();
    for(const width of [1440,390,320]){await page.setViewportSize({width,height:1080});for(const [mode,label] of [['minimal','Minimal'],['condensed','Condensed'],['detailed','Detailed']]){
      await page.getByRole('button',{name:label,exact:true}).click();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${theme}/${width}/${mode}`);
      assert.equal(await page.locator('.flow-priority-mark').count(),mode==='minimal'?0:6);
      const samples=await page.locator('.flow-card').evaluateAll(cards=>cards.map(card=>{const c=getComputedStyle(card);return{level:card.dataset.priority,bg:c.backgroundColor,ink:c.color,soft:c.getPropertyValue('--pl-soft'),tones:[...card.querySelectorAll('.flow-main-label>span')].map(el=>getComputedStyle(el).color)};}));
      const rgb=s=>s.startsWith('#')?s.slice(1).match(/../g).map(x=>parseInt(x,16)):s.match(/[\d.]+/g).slice(0,3).map(Number);
      const lum=s=>rgb(s).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;}).reduce((s,x,i)=>s+x*[.2126,.7152,.0722][i],0);
      const ratio=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
      for(const s of samples){assert.ok(ratio(s.bg,s.ink)>=4.5,`${theme} ${s.level} primary contrast`);assert.ok(ratio(s.bg,s.soft.trim())>=4.5,`${theme} ${s.level} secondary contrast`);for(const tone of s.tones)assert.ok(ratio(s.bg,tone)>=4.5,`${theme} ${s.level} semantic label contrast ${tone}`);}
      palettes[theme]=samples.map(s=>s.bg);assert.equal(new Set(samples.map(s=>s.bg)).size,5);
    }}
  }
  assert.notDeepEqual(palettes.light,palettes.dark);
  await page.setViewportSize({width:1440,height:1080});await page.getByRole('button',{name:/^Blueprints/}).click();await page.getByRole('button',{name:'priority-1.yaml',exact:true}).click();
  const select=page.locator('#flow-priority');await select.selectOption('5');assert.ok((await page.locator('#flow-yaml').inputValue()).includes('# evidence comment'));
  const previousRevision=await page.locator('.flow-footer').innerText();
  await page.getByRole('button',{name:'Validate draft',exact:true}).click();await page.getByRole('button',{name:'Save blueprint',exact:true}).click();
  await page.waitForFunction(old=>document.querySelector('.flow-footer')?.innerText!==old,previousRevision);
  await page.getByRole('button',{name:'All flows',exact:true}).click();
  assert.equal(await page.locator('.flow-card[data-priority="1"]').count(),1,'existing instance keeps original priority');
  fixture.emit({event:'priority.1',id:'new-priority',result:99});await page.waitForFunction(()=>document.querySelectorAll('.flow-card').length===7);
  assert.equal(await page.locator('.flow-card[data-priority="5"]').count(),2,'new instance uses edited priority');
  await page.getByRole('button',{name:/^Blueprints/}).click();await page.getByRole('button',{name:'priority-1.yaml',exact:true}).click();
  await page.locator('#flow-yaml').fill('priority: [invalid');assert.equal(await select.isDisabled(),true);
  for(const locale of ['en','de','es','fr','it','ja','zh-CN']){await page.locator('.precision-settings summary').click();await page.locator('#settings-language').selectOption(locale);await page.locator('.precision-settings header button').click();assert.equal(await select.locator('option').count(),6);assert.equal(await page.locator('label[for="flow-priority"]').innerText().then(s=>s.length>0),true);}
  assert.deepEqual(errors,[]);console.log('Priority browser checks passed: five levels/default, two themes, contrast, three densities/widths, draft edits/comments, pinned revisions, invalid YAML, seven locales.');
}finally{await browser?.close();await fixture.close();await new Promise(resolve=>server.close(resolve));}

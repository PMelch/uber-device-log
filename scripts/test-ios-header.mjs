// Synthetic native iOS rendering; run after npm run build.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createSemanticFlowsFixture } from '../server/fixtures/semantic-flows-ui.mts';
const output = process.env.IOS_HEADER_ARTIFACTS ?? '/tmp/ios-header-screenshots';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});
const errors=[]; let checks=0, minimum=100;
const raw='Nov 6 08:35:36 funstages-iPhone-11 BloomBoomCasino(AudioToolbox)[662] <Notice>: SSClientCompletion.cpp:83 Calling client...';
try {
 for(const platform of ['ios','android']) {
  const fixture=await createSemanticFlowsFixture(false,platform);
  const server=await new Promise(resolve=>{const s=fixture.app.listen(0,'127.0.0.1',()=>resolve(s));});
  try {for(const width of [1440,390]) for(const theme of ['light','dark']) {
   const page=await browser.newPage({viewport:{width,height:1000}});
   page.on('pageerror',error=>errors.push(error.message));
   await page.addInitScript(({platform,theme})=>{localStorage.setItem('uber-device-log.lastDevice',platform+':semantic-phone');localStorage.setItem('uber-device-log.theme',theme);localStorage.setItem('uber-device-log.language','en');},{platform,theme});
   await page.goto('http://127.0.0.1:'+server.address().port);
   await page.waitForFunction(async()=>(await(await fetch('/fixture/state')).json()).native===1);
   const malicious=raw+'\r\n  <img src=x onerror="window.pwned=true"> & <script>evil</script>';
   fixture.emitNative({message:malicious});
   for(const level of ['Debug','Info','Warning','Error','Fault','Custom']) fixture.emitNative({message:raw.replace('<Notice>','<'+level+'>')});
   fixture.emitNative({message:'Unknown date App[1]: unchanged'});
   fixture.emitNative({message:raw+'\n    at example.Checkout.run(Checkout.java:42)'});
   await page.locator('.precision-stack').waitFor();
   assert.equal(await page.locator('.precision-msg img, .precision-msg script').count(),0);
   assert.equal(await page.evaluate(()=>window.pwned),undefined);
   const message=page.locator('.precision-msg').filter({hasText:'onerror='});
   assert.equal(await message.textContent(),malicious);
   assert.equal(await page.locator('.precision-stack [data-ios-token]').count(),0);
   if(platform==='ios') {
    assert.equal(await message.locator('[data-ios-token]').count(),6);
    // Actual theme variables cover normal, wash (hover/stripe), selected and severity rows.
    const contrasts=await page.evaluate(()=>{
     const root=document.querySelector('#precision-design'), style=getComputedStyle(root);
     const rgb=value=>{const el=document.createElement('span');el.style.color=value;root.append(el);const color=getComputedStyle(el).color.match(/[\d.]+/g).slice(0,3).map(Number);el.remove();return color;};
     const lum=c=>c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
     const inks=[...document.querySelectorAll('[data-ios-token]')].map(el=>getComputedStyle(el).color);
     return inks.flatMap(ink=>['--pl-panel','--pl-wash','--pl-accent-bg','--pl-error-bg','--pl-warn-bg'].map(bg=>{const a=lum(rgb(ink)),b=lum(rgb(style.getPropertyValue(bg)));return(Math.max(a,b)+.05)/(Math.min(a,b)+.05);}));
    });
    for(const ratio of contrasts){assert.ok(ratio>=4.5,'contrast '+ratio);minimum=Math.min(minimum,ratio);checks++;}
    await message.locator('..').locator('..').locator('input[type=checkbox]').check();
    await page.screenshot({path:output+'/'+theme+'-'+width+'.png',fullPage:true});
    await page.locator('.logs').focus();await page.keyboard.press('Escape');
    await page.locator('.source-filters .overlay-trigger').first().click();
    const search=page.locator('.precision-searchbar > input:visible');await search.fill('AudioToolbox');
    await page.waitForFunction(()=>!document.querySelector('.precision-empty') && document.querySelectorAll('.precision-ios-header').length>0);
    assert.ok(await page.locator('[data-ios-token=subsystem]').count()>0);
    await search.fill('');await page.keyboard.press('Escape');
    const resume=page.locator('.precision-pause[aria-pressed=true]');if(await resume.count()) await resume.click();
    await page.locator('.precision-source-choice').nth(1).click();
    await page.waitForFunction(async()=>(await(await fetch('/fixture/state')).json()).webview===1);
    fixture.emit({message:raw},true);
    await page.locator('.precision-msg').filter({hasText:'{"message"'}).waitFor();
    assert.equal(await page.locator('.precision-msg').filter({hasText:'{"message"'}).locator('[data-ios-token]').count(),0);
   } else assert.equal(await page.locator('[data-ios-token]').count(),0);
   await page.close();
  }} finally {await fixture.close();await new Promise(resolve=>server.close(resolve));}
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({cases:8,contrastChecks:checks,minimumContrast:minimum,screenshots:output}));
} finally {await browser.close();}

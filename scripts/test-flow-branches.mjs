import { createServer } from 'vite';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import { writeFile, rm, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
// Run with the same PLAYWRIGHT_MODULE / CHROME_EXECUTABLE overrides as test-semantic-flows.mjs.
const root = fileURLToPath(new URL('../', import.meta.url));
const filename = `.flow-branches-test-${process.pid}.html`;
const file = root + filename;
let server, browser;
try {
if (process.env.SEMANTIC_FLOWS_SCREENSHOTS) await mkdir(process.env.SEMANTIC_FLOWS_SCREENSHOTS, {recursive:true});
await writeFile(file, `<div id="precision-design"><div id="app"></div></div><script type="module">
import {createApp, reactive, h} from 'vue';
import '/src/style.css';
import FlowWorkspace from '/src/components/FlowWorkspace.vue';
const branches = ['a','b','c','d'].slice(0, Number(new URLSearchParams(location.search).get('count')) || 4);
const steps = [{id:'start',name:'Choose a delivery method',next:branches,match:{}},...branches.map(id=>({id,name:'Native purchase alternative '+id+' with a longer description that wraps across several lines',next:['done'],match:{}})),{id:'done',name:'Complete delivery',match:{}}];
const blueprint={id:'test',name:branches.length+' paths',steps};
window.props=reactive({snapshot:{enabled:true,files:[],blueprints:[blueprint],diagnostics:[],revision:'1'},instances:[{id:'fork',blueprint,outcome:'running',completeness:'complete',startedAt:Date.now()-12000,updatedAt:Date.now(),expected:branches,observations:[{stepId:'start',accepted:true,payload:{},receivedAt:Date.now()-12000,message:{timestamp:'2026-10-21',message:'start',source:'device'}}],deviceId:'Fixture',revision:'1'}],locale:'de',activeSources:1,loading:false,gapCount:0});
createApp({render:()=>h(FlowWorkspace,window.props)}).mount('#app');
</script><style>:root{--pl-text:#27382e;--pl-panel:#fff;--pl-line:#789084;--pl-soft:#50645a;--pl-wash:#f2f6f3;--pl-accent:#287653;--pl-accent-bg:#e2f3e8; font-family:Arial}body{margin:20px;background:#f2f6f3}</style>`);
server = await createServer({root,server:{host:'127.0.0.1',port:0}}); await server.listen();
browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE ? {executablePath:process.env.CHROME_EXECUTABLE} : {})});
const page=await browser.newPage();
const checkSvg = async selector => {
 const size = await page.locator(selector).evaluate(svg => ({width:svg.getBoundingClientRect().width,height:svg.getBoundingClientRect().height,expectedWidth:Number(svg.getAttribute('width')),expectedHeight:Number(svg.getAttribute('height'))}));
 assert.equal(size.width,size.expectedWidth,selector+' must retain its graph width under app icon styles');
 assert.equal(size.height,size.expectedHeight,selector+' must retain its graph height under app icon styles');
};
for(const count of [2,4]){
for(const width of [1800,390]){
 for(const locale of ['en','es','de','fr','it','ja','zh-CN']){
 await page.setViewportSize({width,height:1000});
 await page.goto(server.resolvedUrls.local[0]+filename+'?count='+count);
 await page.locator('.flow-lane').last().waitFor();
 await page.evaluate(locale=>window.props.locale=locale,locale);
 assert.equal(await page.locator('.flow-lane').count(),count);
 const alignment=await page.evaluate(()=>{const trunk=document.querySelector('.flow-path .flow-node').getBoundingClientRect();const lanes=[...document.querySelectorAll('.flow-lane .flow-node')].map(n=>n.getBoundingClientRect());return {trunk:trunk.y+trunk.height/2,lanes:lanes.map(r=>r.y+r.height/2),overflow:document.documentElement.scrollWidth>innerWidth};});
 assert.ok(Math.abs(alignment.trunk-alignment.lanes[0])<2,JSON.stringify(alignment));
 assert.equal(alignment.overflow,false);
 await checkSvg('.flow-fork svg');
 if (process.env.SEMANTIC_FLOWS_SCREENSHOTS && locale === 'de') await page.locator('.flow-card').screenshot({path:process.env.SEMANTIC_FLOWS_SCREENSHOTS+'/flow-branches-'+count+'-'+width+'.png'});
 await page.locator('.flow-actions button').first().click();
 await page.locator('.flow-diagram-node').last().waitFor();
 assert.equal(await page.locator('.flow-diagram-node').count(),count+2);
 assert.equal(await page.locator('.flow-diagram path').count(),count*2);
 await page.locator('.flow-diagram-node').nth(count).focus();
 assert.equal(await page.locator('.flow-diagram-node').nth(count).evaluate(n=>n===document.activeElement),true);
 await checkSvg('.flow-diagram svg');
 if (process.env.SEMANTIC_FLOWS_SCREENSHOTS && locale === 'de') await page.locator('.flow-detail').screenshot({path:process.env.SEMANTIC_FLOWS_SCREENSHOTS+'/flow-detail-'+count+'-'+width+'.png'});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
}
}
}
console.log('Two- and four-branch overview and detail pass at desktop/mobile widths, including keyboard focus.');
} finally {await browser?.close();await server?.close();await rm(file,{force:true});}

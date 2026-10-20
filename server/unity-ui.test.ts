import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { unityManifest, unityCatalogs, unityContext, unityTranslate, resolveUnityMessage } from '../src/plugins/unity/catalog';

test('Unity has seven complete contextual catalogs', () => {
 assert.equal(unityManifest.defaultLocale, 'en');
 assert.deepEqual(Object.keys(unityCatalogs).sort(), ['en','es','de','fr','it','ja','zh-CN'].sort());
 for (const catalog of Object.values(unityCatalogs)) {
  assert.deepEqual(Object.keys(catalog).sort(), Object.keys(unityCatalogs.en).sort());
  for (const [key, value] of Object.entries(catalog)) { assert.ok(value.trim()); assert.ok(unityContext[key as keyof typeof unityContext]?.length); }
 }
 assert.equal(unityTranslate('DE_at','projectSources'), unityCatalogs.de.projectSources);
 assert.equal(unityTranslate('zh_cn','projectSources'), unityCatalogs['zh-CN'].projectSources);
});
test('Unity resolves each key selected then base then manifest default', () => {
 const catalogs = { en:{a:'default', b:'fallback'}, pt:{a:'base'}, 'pt-BR':{b:'selected'} };
 assert.equal(resolveUnityMessage(catalogs,'en','pt_br','a'), 'base');
 assert.equal(resolveUnityMessage(catalogs,'en','pt_br','b'), 'selected');
 assert.equal(resolveUnityMessage(catalogs,'en','xx','a'), 'default');
});
test('Unity setup owns lifecycle and separates revoke from viewer disconnect', () => {
 const ui = readFileSync(new URL('../src/components/UnitySources.vue', import.meta.url),'utf8');
 assert.match(ui,/onUnmounted/); assert.match(ui,/clearTimeout/); assert.match(ui,/AbortController/);
 assert.match(ui,/X-UDL-Unity/); assert.match(ui,/DELETE/); assert.match(ui,/viewerHint/);
 assert.doesNotMatch(ui,/localStorage|sessionStorage|console.log|JavaScriptConsole|InspectorAction/);
 const app = readFileSync(new URL('../src/App.vue',import.meta.url),'utf8');
 assert.match(app,/<UnitySources/); assert.match(app,/unityTranslate/);
});

test('Unity setup renders localized accessible entry without browser globals', async () => {
 const { createServer } = await import('vite');
 const { createSSRApp, h } = await import('vue');
 const { renderToString } = await import('vue/server-renderer');
 const server = await createServer({server:{middlewareMode:true,watch:null,ws:false}});
 try {
  const {default: UnitySources} = await server.ssrLoadModule('/src/components/UnitySources.vue');
  for (const locale of Object.keys(unityCatalogs)) {
   const html = await renderToString(createSSRApp({render:()=>h(UnitySources,{locale,selected:'',deviceState:(s:string)=>s})}));
   assert.ok(html.includes(unityTranslate(locale,'projectSources')));
   assert.ok(html.includes(unityTranslate(locale,'loading')));
   assert.doesNotMatch(html, /JavaScriptConsole|InspectorAction/);
  }
 } finally { await server.close(); }
});

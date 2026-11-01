import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { languages, translate } from '../src/i18n/index.js';
test('source management localizes scope, activation and installation controls without rendering authored HTML', async () => {
  const vite = await createServer({ server: { middlewareMode: true, watch: null, ws: false } });
  try {
    const { default: Sources } = await vite.ssrLoadModule('/src/components/FlowSources.vue');
    for (const { code } of languages) for (const context of ['global','project']) {
      const snapshot = { enabled:true,context,revision:'r',token:'secret',configRevision:'cfg',files:[],blueprints:[],diagnostics:[],sources:[{id:'global:bundle:sample',scope:'global',kind:'bundle',name:'<img src=x>',description:'Description <script>data</script>',specVersion:1,filename:'sample.blueprint',enabled:false,blueprintIds:['one'],activeBlueprintIds:[],diagnostics:[]}] };
      const html = await renderToString(createSSRApp({render:()=>h(Sources,{snapshot,locale:code})}));
      assert.ok(html.includes(translate(code,'flowsBlueprintSources'))); assert.ok(html.includes(translate(code,context==='project'?'flowsContextProject':'flowsContextGlobal')));
      assert.ok(html.includes(translate(code,'flowsBundleInstall'))); assert.match(html,/&lt;img src=x&gt;/); assert.doesNotMatch(html,/<img |secret/);
      assert.match(html,/type="url"/); assert.match(html,/aria-checked="false"/);
    }
  } finally { await vite.close(); }
});

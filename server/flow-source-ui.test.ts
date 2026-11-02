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
test('inactive source sharing an ID with other conflicting sources does not inherit their warning', async () => {
  const vite = await createServer({ server: { middlewareMode: true, watch: null, ws: false } });
  try {
    const { default: Sources } = await vite.ssrLoadModule('/src/components/FlowSources.vue');
    const diagnostic = { code: 'flowsSourceConflict', params: { id: 'shared', sources: 'global:bundle:other/one.yaml, project:loose/two.yaml' }, message: 'conflict' };
    const source = { id:'global:bundle:inactive',scope:'global',kind:'bundle',name:'Inactive bundle',filename:'inactive.blueprint',enabled:false,blueprintIds:['shared'],activeBlueprintIds:[],diagnostics:[] };
    const snapshot = { enabled:true,context:'project',revision:'r',files:[],blueprints:[],diagnostics:[diagnostic],sources:[source] };
    const html = await renderToString(createSSRApp({render:()=>h(Sources,{snapshot,locale:'en'})}));
    assert.ok(!html.includes(translate('en','flowsSourceNeedsAttention')));
    assert.ok(!html.includes(translate('en','flowsSourceConflict',diagnostic.params)));
    assert.ok(html.includes('shared'), 'inactive inventory remains available');
  } finally { await vite.close(); }
});
test('source details distinguish stored definitions, tracking and conflicts without borrowing another source name', async () => {
  const vite = await createServer({ server: { middlewareMode: true, watch: null, ws: false } });
  try {
    const { default: Sources } = await vite.ssrLoadModule('/src/components/FlowSources.vue');
    const diagnostic = { code: 'flowsSourceConflict', params: { id: 'shared', sources: 'global:bundle:sample, project:loose' }, message: 'conflict' };
    const source = { id:'global:bundle:sample',scope:'global',kind:'bundle',name:'Sample bundle',specVersion:1,filename:'sample.blueprint',enabled:true,blueprintIds:['shared','unique'],activeBlueprintIds:['unique'],diagnostics:[] };
    const snapshot = { enabled:true,context:'project',revision:'r',configRevision:'cfg',files:[],blueprints:[{id:'shared',name:'Wrong source name',sourceId:'project:loose'},{id:'unique',name:'Actual authored name',sourceId:source.id}],diagnostics:[diagnostic],sources:[source] };
    const html = await renderToString(createSSRApp({render:()=>h(Sources,{snapshot,locale:'en'})}));
    assert.ok(html.includes(translate('en','flowsSourceStored',{count:'2'})));
    assert.ok(html.includes(translate('en','flowsSourceActive',{count:'1'})));
    assert.ok(html.includes(translate('en','flowsSourcePartial')));
    assert.ok(html.includes(translate('en','flowsSourceNeedsAttention')));
    assert.ok(html.includes(translate('en','flowsSourceConflict',diagnostic.params)));
    assert.ok(html.includes('Actual authored name')); assert.ok(html.includes('shared'));
    assert.ok(!html.includes('Wrong source name'));
    assert.match(html,/aria-pressed="true"/);
    assert.doesNotMatch(html,/<details[^>]*class="flow-bundle-disclosure"[^>]* open/);
  } finally { await vite.close(); }
});

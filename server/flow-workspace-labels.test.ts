import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'vite';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';

// Render the real workspace: authored text and extracted values must never be HTML.
test('workspace renders rich main labels, result fields and display controls without exposing sensitive values', async () => {
  const server = await createServer({ server: { middlewareMode: true, watch: null, ws: false } });
  try {
    const { default: Workspace } = await server.ssrLoadModule('/src/components/FlowWorkspace.vue');
    const blueprint = { version: 1, id: 'bank', priority: 2, name: 'Bank transfer', start: 'done', timeout: '30s', correlation: { scope: 'device-session', primary: 'id' }, steps: [{
      id: 'done', name: 'Transfer settled', match: { contains: 'settled' }, outcome: 'completed',
      extract: { id: { json: 'id' }, amount: { json: 'amount', result: true }, recipient: { json: 'recipient', result: true, sensitive: true }, internal: { json: 'internal' } },
      label: [{ text: 'Transfer {done.id}: ' }, { text: 'successful', tone: 'success' }, { text: ' for {done.recipient}' }],
    }] };
    const instance = { id: 'bank-1', blueprint, revision: 'rev-1', deviceId: 'phone', outcome: 'completed', completeness: 'complete', startedAt: 1000, updatedAt: 1200, expected: [], bindings: { id: 't1' }, observations: [{ stepId: 'done', accepted: true, receivedAt: 1200, payload: { id: '<img src=x>', amount: 42, recipient: 'CONFIDENTIAL-ACCOUNT', internal: 'INTERNAL-DEBUG' } }] };
    const html = await renderToString(createSSRApp({ render: () => h(Workspace, { snapshot: { enabled: true, files: [], blueprints: [blueprint], diagnostics: [], revision: 'rev-1', projectName: 'fixture', directory: '.udl/flows' }, instances: [instance], loading: false, activeSources: 1, gapCount: 0, locale: 'en' }) }));
    assert.match(html.replace(/<[^>]*>/g, ''), /Transfer &lt;img src=x&gt;: /);
    assert.match(html, /data-priority="2"/);
    assert.match(html, /class="flow-card-kind">Bank transfer <small>\(bank\)<\/small><\/span>/);
    assert.doesNotMatch(html, /class="flow-id"|#bank-1/);
    assert.match(html, /flow-label-success[^>]*>successful/);
    assert.match(html, /flow-results/);
    assert.match(html, />amount<\/dt>/);
    assert.match(html, />42<\/dd>/);
    assert.match(html, /Detailed/);
    assert.match(html, /Condensed/);
    assert.doesNotMatch(html, /<img |CONFIDENTIAL-ACCOUNT|INTERNAL-DEBUG/);
    for (const outcome of ['running', 'completed', 'failed', 'cancelled', 'timed_out', 'interrupted']) {
      const statusHtml = await renderToString(createSSRApp({ render: () => h(Workspace, { snapshot: { enabled: true, files: [], blueprints: [blueprint], diagnostics: [], revision: 'rev-1', projectName: 'fixture', directory: '.udl/flows' }, instances: [{ ...instance, outcome }], loading: false, activeSources: 1, gapCount: 0, locale: 'en' }) }));
      assert.equal(statusHtml.includes('flow-status-spinner'), outcome === 'running', `${outcome}: spinner represents active progression only`);
      if (outcome === 'running') assert.match(statusHtml, /In progress/);
    }

  } finally { await server.close(); }
});

test('an observed repeatable step stays on the trunk instead of appearing as an alternative route', async () => {
  const server = await createServer({ server: { middlewareMode: true, watch: null, ws: false } });
  try {
    const { default: Workspace } = await server.ssrLoadModule('/src/components/FlowWorkspace.vue');
    const blueprint = { id: 'loading', name: 'Loading', start: 'start', steps: [
      { id: 'start', name: 'Started', next: ['progress'] },
      { id: 'progress', name: 'Progress', repeatable: true, label: 'Loading {progress.percent}%', extract: { percent: { json: 'percent', result: true } }, next: ['done'] },
      { id: 'done', name: 'Done', outcome: 'completed' },
    ] };
    const instance = { id: 'loading-1', blueprint, outcome: 'running', completeness: 'complete', expected: ['progress', 'done'], deviceId: 'phone', startedAt: 0, updatedAt: 1000, bindings: {}, observations: [{ stepId: 'start', payload: {} }, { stepId: 'progress', payload: { percent: 10 } }, { stepId: 'progress', payload: { percent: 60 } }] };
    const html = await renderToString(createSSRApp({ render: () => h(Workspace, { snapshot: { enabled: true, files: [], blueprints: [blueprint], diagnostics: [], revision: 'r1' }, instances: [instance], loading: false, activeSources: 1, gapCount: 0, locale: 'en' }) }));
    assert.match(html.replace(/<[^>]*>/g, ''), /Loading 60%/);
    assert.match(html, /data-priority="3"/);
    assert.doesNotMatch(html, /class="flow-fork"/, 'repeated observations do not create a graph fork');
    assert.equal((html.match(/class="flow-node"/g) ?? []).length, 3, 'one node per graph step, not one per occurrence');
  } finally { await server.close(); }
});

test('sensitive error codes never leak through automatic failure decorations', async () => {
  const server = await createServer({ server: { middlewareMode: true, watch: null, ws: false } });
  try {
    const { default: Workspace } = await server.ssrLoadModule('/src/components/FlowWorkspace.vue');
    const blueprint = { id: 'private', name: 'Private error', start: 'start', steps: [{id:'start',name:'Start',next:['done']},{id:'done',name:'Done',outcome:'completed'}], errors:[{id:'failure',codeField:'code',codes:{},extract:{code:{json:'code',sensitive:true}}}] };
    const instance = { id:'private-1',blueprint,outcome:'failed',completeness:'complete',expected:[],deviceId:'phone',startedAt:0,updatedAt:1,bindings:{},errorCode:'SECRET-ERROR',observations:[{stepId:'start',payload:{}},{stepId:'failure',payload:{code:'SECRET-ERROR'},errorCode:'SECRET-ERROR'}] };
    const html = await renderToString(createSSRApp({render:()=>h(Workspace,{snapshot:{enabled:true,files:[],blueprints:[blueprint],diagnostics:[],revision:'r'},instances:[instance],loading:false,activeSources:1,gapCount:0,locale:'en'})}));
    assert.doesNotMatch(html,/SECRET-ERROR/);
  } finally { await server.close(); }
});

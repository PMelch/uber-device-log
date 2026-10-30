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
    const blueprint = { version: 1, id: 'bank', name: 'Bank transfer', start: 'done', timeout: '30s', correlation: { scope: 'device-session', primary: 'id' }, steps: [{
      id: 'done', name: 'Transfer settled', match: { contains: 'settled' }, outcome: 'completed',
      extract: { id: { json: 'id' }, amount: { json: 'amount', result: true }, recipient: { json: 'recipient', result: true, sensitive: true }, internal: { json: 'internal' } },
      label: [{ text: 'Transfer {done.id}: ' }, { text: 'successful', tone: 'success' }, { text: ' for {done.recipient}' }],
    }] };
    const instance = { id: 'bank-1', blueprint, revision: 'rev-1', deviceId: 'phone', outcome: 'completed', completeness: 'complete', startedAt: 1000, updatedAt: 1200, expected: [], bindings: { id: 't1' }, observations: [{ stepId: 'done', accepted: true, receivedAt: 1200, payload: { id: '<img src=x>', amount: 42, recipient: 'CONFIDENTIAL-ACCOUNT', internal: 'INTERNAL-DEBUG' } }] };
    const html = await renderToString(createSSRApp({ render: () => h(Workspace, { snapshot: { enabled: true, files: [], blueprints: [blueprint], diagnostics: [], revision: 'rev-1', projectName: 'fixture', directory: '.udl/flows' }, instances: [instance], loading: false, activeSources: 1, gapCount: 0, locale: 'en' }) }));
    assert.match(html.replace(/<[^>]*>/g, ''), /Transfer &lt;img src=x&gt;: /);
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

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'vite';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { languages, translate } from '../src/i18n';

test('flow workspace keeps configuration, diagnostics, and captured data separate and escapes evidence', async () => {
  const server = await createServer({ server: { middlewareMode: true, watch: null, ws: false } });
  try {
    const { default: Workspace } = await server.ssrLoadModule('/src/components/FlowWorkspace.vue');
    const render = (props: Record<string, unknown>) => renderToString(createSSRApp({ render: () => h(Workspace, { snapshot: null, instances: [], loading: false, activeSources: 2, gapCount: 0, locale: 'en', ...props }) }));
    const escaped = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\"', '&quot;').replaceAll("'", '&#39;');
    for (const { code } of languages) {
      const disabled = await render({ locale: code });
      assert.ok(disabled.includes(escaped(translate(code, 'flowsNoProject'))));
      const empty = await render({ locale: code, snapshot: { enabled: true, files: [], blueprints: [], diagnostics: [], revision: '1', projectName: 'project', directory: '.udl/flows' } });
      assert.ok(empty.includes(escaped(translate(code, 'flowsNoBlueprints'))));
      assert.ok(!empty.includes(escaped(translate(code, 'flowsEmpty'))));
      const waiting = await render({ locale: code, snapshot: { enabled: true, files: [], blueprints: [{ id: 'test' }], diagnostics: [], revision: '1', projectName: 'project', directory: '.udl/flows' } });
      assert.ok(waiting.includes(escaped(translate(code, 'flowsEmpty'))));
      assert.ok(empty.includes(escaped(translate(code, 'flowsBlueprints'))));
    }
    const html = await render({ snapshot: { enabled: true, files: [], blueprints: [], diagnostics: [{ code: 'flowsDiagnostic', params: { detail: '<script>bad()</script>' }, message: 'fallback' }], revision: '1' }, instances: [{ id: 'purchase-1', blueprint: { name: '<img src=x onerror=alert(1)>', steps: [{ id: 'first', name: 'First', match: {}, next: ['second'] }, { id: 'second', name: 'Second', match: {} }] }, outcome: 'running', completeness: 'missing_start', startedAt: 0, updatedAt: 1500, expected: ['second'], observations: [{ stepId: 'first', payload: { secret: 'never-render-this' } }], deviceId: 'phone-1', revision: 'rev-1' }] });
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(html, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
    assert.doesNotMatch(html, /<script>|<img |never-render-this/);
    assert.ok(html.includes(translate('en', 'flowsExpected')));
    assert.ok(html.includes(translate('en', 'flowsCompletenessMissingStart')));
    const fork = await render({ snapshot: { enabled: true, files: [], blueprints: [], diagnostics: [], revision: '1', projectName: 'project', directory: '.udl/flows' }, instances: [{ id: 'purchase-2', blueprint: { id: 'purchase', name: 'Purchase', steps: [{ id: 'start', name: 'Start', match: {}, next: ['pay', 'cancel'] }, { id: 'pay', name: 'Pay', match: {}, next: ['done'] }, { id: 'cancel', name: 'Cancel', match: {} }, { id: 'done', name: 'Done', match: {} }] }, outcome: 'running', completeness: 'complete', startedAt: 0, updatedAt: 1000, expected: ['pay', 'cancel'], observations: [{ stepId: 'start', accepted: true, payload: {} }], deviceId: 'phone-1', revision: 'rev-1' }] });
    assert.match(fork, /<path[^>]* d="M [^"]* C /);
    assert.ok(fork.includes('Pay') && fork.includes('Cancel'));
    assert.equal(fork.includes(translate('en', 'flowsNotOnRoute')), false);
    const optionalFork = await render({ snapshot: { enabled: true, files: [], blueprints: [], diagnostics: [], revision: '1', projectName: 'project', directory: '.udl/flows' }, instances: [{ id: 'purchase-3', blueprint: { id: 'purchase', name: 'Purchase', steps: [{ id: 'receipt', name: 'Receipt', match: {}, next: ['receipt_debug', 'submit'] }, { id: 'receipt_debug', name: 'Receipt debug', match: {}, optional: true, next: ['submit'] }, { id: 'submit', name: 'Submit', match: {} }] }, outcome: 'running', completeness: 'complete', startedAt: 0, updatedAt: 1000, expected: ['receipt_debug', 'submit'], observations: [{ stepId: 'receipt', accepted: true, payload: {} }], deviceId: 'phone-1', revision: 'rev-1' }] });
    assert.ok(optionalFork.includes('Receipt debug'));
    assert.ok(optionalFork.includes('Submit'));
    assert.ok((optionalFork.match(/<path /g) ?? []).length >= 2);
  } finally { await server.close(); }
});

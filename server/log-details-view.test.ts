import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'vite';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { languages, translate } from '../src/i18n';

test('details render translated metadata and explanations safely in every language', async () => {
  const server = await createServer({ server: { middlewareMode: true, watch: null, ws: false } });
  try {
    const { default: Details } = await server.ssrLoadModule('/src/components/LogDetails.vue');
    for (const { code } of languages) {
      const html = await renderToString(createSSRApp({ render: () => h(Details, {
        record: {
          entry: { key: 0, timestamp: '2026-09-30T08:53:00.000Z', message: 'Sep 30 10:53:00 Phone <script>evil</script>[0] <Error>: <private>' },
          device: { id: 'test', name: '<img src=x onerror=alert(1)>', platform: 'ios', state: 'connected' },
        },
        pinned: false, position: { left: '12px', top: '12px' }, locale: code,
      }) }));
      assert.ok(html.includes(translate(code, 'detailTabFields')), code);
      assert.ok(html.includes(translate(code, 'detailGeneric')), code);
      assert.match(html, /role="dialog"/);
      assert.match(html, /&lt;script&gt;evil&lt;\/script&gt;/);
      assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
      assert.doesNotMatch(html, /<script>|<img /);
    }
  } finally { await server.close(); }
});

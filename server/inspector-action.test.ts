import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { translate } from '../src/i18n';
test('inspector actions distinguish Chrome DevTools and Safari guidance in localized source rows', async () => {
  const server = await createServer({ server: { middlewareMode: true, watch: null, ws: false } });
  try {
    const { default: InspectorAction } = await server.ssrLoadModule('/src/components/InspectorAction.vue');
    const render = (platform: string) => renderToString(createSSRApp({ render: () => h(InspectorAction, {
      source: {key:'web:1',deviceId:'phone',name:'Pixel',platform,webview:{id:'1',socket:'socket',title:'Page',url:'https://example.test'}},
      compact: true,
      t: (key: Parameters<typeof translate>[1]) => translate('en',key),
    }) }));
    assert.match(await render('android'), /Open Chrome DevTools/);
    assert.match(await render('ios'), /Inspect in Safari/);
    assert.match(await render('android'), /<span[^>]*>Inspect<\/span>/);
    assert.match(await render('ios'), /<span[^>]*>Inspect<\/span>/);
    assert.match(await render('ios'), /aria-haspopup="dialog"/);
  } finally { await server.close(); }
});

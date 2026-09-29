import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';

test('device picker renders a disabled trigger without a disclosure when empty', async () => {
  const server = await createServer({
    server: { middlewareMode: true, watch: null, ws: false },
  });
  try {
    const { default: Menu } = await server.ssrLoadModule('/src/components/PrecisionMenu.vue');
    const renderMenu = (disabled: boolean) => renderToString(createSSRApp({
      render: () => h(Menu, { label: 'Choose connected device', disabled }, {
        selected: () => 'No connected devices',
        default: () => h('button', 'Test device'),
      }),
    }));
    const empty = await renderMenu(true);
    assert.match(empty, /<button[^>]*\bdisabled(?:[\s>])/);
    assert.match(empty, /aria-label="Choose connected device"/);
    assert.match(empty, /No connected devices/);
    assert.doesNotMatch(empty, /<details|<summary|Test device/);

    const available = await renderMenu(false);
    assert.match(available, /<details/);
    assert.match(available, /<summary/);
    assert.match(available, /Test device/);

    const { default: App } = await server.ssrLoadModule('/src/App.vue');
    const initial = await renderToString(createSSRApp(App));
    assert.match(initial, /<button[^>]*disabled[^>]*aria-label="Choose connected device"/);
  } finally {
    await server.close();
  }
});

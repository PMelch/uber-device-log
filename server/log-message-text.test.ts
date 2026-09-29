import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';

test('stack renderer highlights source locations and escapes all log content', async () => {
  const server = await createServer({ server: { middlewareMode: true, watch: null, ws: false } });
  try {
    const { default: LogMessageText } = await server.ssrLoadModule('/src/components/LogMessageText.vue');
    const render = (message: string) => renderToString(createSSRApp({ render: () => h(LogMessageText, { message }) }));
    const html = await render('java.lang.Error: <img src=x onerror=alert(1)>\n\tat a.b.<init>(File.java:42)\nCaused by: java.io.IOException: broken');
    assert.match(html, /data-kind="exception"/);
    assert.match(html, /data-kind="frame"/);
    assert.match(html, /class="precision-stack-location">\(File.java:42\)/);
    assert.match(html, /data-kind="cause"/);
    assert.match(html, /&lt;img/);
    assert.match(html, /&lt;init&gt;/);
    assert.doesNotMatch(html, /<img|<init>/);
    assert.equal(await render('hello\n  world'), '<span class="precision-msg">hello\n  world</span>');
  } finally {
    await server.close();
  }
});

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

    const native = await render('signal 11 (SIGSEGV), code 1, fault addr 0x0\n#00 pc 00001234 /data/app/libscene.so (<script>alert(1)</script>+8)');
    assert.match(native, /data-kind="signal"/);
    assert.match(native, /data-kind="native-frame"/);
    assert.match(native, /&lt;script&gt;/);
    assert.doesNotMatch(native, /<script>/);
    const apple = await render("*** Terminating app due to uncaught exception 'NSException', reason: '<img src=x>'\n0   CrashDemo  0x0000000100000100 -[Scene open:] + 32");
    assert.match(apple, /data-kind="exception"/);
    assert.match(apple, /data-kind="native-frame"/);
    assert.doesNotMatch(apple, /<img/);
    assert.equal(await render('hello\n  world'), '<span class="precision-msg">hello\n  world</span>');
  } finally {
    await server.close();
  }
});

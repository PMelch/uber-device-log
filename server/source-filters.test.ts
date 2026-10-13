import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { defaultSourceFilter } from '../shared/log-sources';
import { translate } from '../src/i18n';
import type { LogSourceMetadata } from '../shared/types';

test('source filters scope accessible names, native metadata and levels to each source', async () => {
  const server = await createServer({ server: { middlewareMode: true, watch: null, ws: false } });
  try {
    const { default: SourceFilters } = await server.ssrLoadModule('/src/components/SourceFilters.vue');
    const render = (source: LogSourceMetadata) => renderToString(createSSRApp({ render: () => h(SourceFilters, {
      source, modelValue: { ...defaultSourceFilter(), pid: 'invalid' },
      t: (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) => translate('de', key, params),
      levelLabel: (level: string) => level,
    }) }));
    const device = { key: 'android:phone', deviceId: 'phone', name: 'Pixel', platform: 'android' as const };
    const native = await render(device);
    assert.match(native, /aria-label="Pixel filtern"/);
    assert.match(native, /aria-label="Level für Pixel"/);
    assert.match(native, /aria-invalid="true"/);
    assert.match(native, /precision-android/);
    const web = await render({ ...device, key: 'web:1', name: 'Slot', webview: { id: '1', socket: 'webview_devtools_remote_1', title: 'Slot', url: 'https:\/\/example.test' } });
    assert.match(web, /aria-label="Slot filtern"/);
    assert.match(web, /precision-web/);
    assert.doesNotMatch(web, /inputmode="numeric"|aria-invalid/);
    const ios = await render({ ...device, platform: 'ios' });
    assert.match(ios, /precision-severity[^>]*disabled/);
    assert.doesNotMatch(ios, /inputmode="numeric"/);
  } finally { await server.close(); }
});

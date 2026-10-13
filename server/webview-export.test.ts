import assert from 'node:assert/strict';
import test from 'node:test';
import { serializeLogExport } from '../shared/log-export';
import type { Device } from '../shared/types';

test('WebView exports identify the console source and preserve the selected target', () => {
  const webview = { id: 'page-1', socket: 'webview_devtools_remote_42', title: 'Checkout', url: 'https://example.test', pid: 42 };
  const device = { id: 'phone', name: 'Pixel', platform: 'android', state: 'connected', webview } as Device;
  const entry = { timestamp: '2026-10-13T10:00:00.000Z', message: 'hello', level: 'I', tag: 'console.log', pid: 42 };
  const result = JSON.parse(serializeLogExport([entry], device, 'json').text);
  assert.equal(result.source, 'android-webview');
  assert.deepEqual(result.webview, webview);
  assert.deepEqual(result.entries, [entry]);
});

test('iOS WebView export uses console provenance and device timestamps', () => {
  const device = {id:'iphone',name:'iPhone',platform:'ios' as const,state:'connected',webview:{id:'2',socket:'PID:42',title:'Slot',url:''}};
  const exported = JSON.parse(serializeLogExport([{timestamp:'2026-01-01T00:00:00Z',message:'hello'}],device,'json').text);
  assert.equal(exported.source,'ios-webview');assert.equal(exported.timestampSource,'device');
});

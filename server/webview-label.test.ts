import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compactContextUrl, webViewLabel } from '../src/webview-label';
const view = (id: string, url: string, title = 'Portal') => ({ id, url, title, socket: 'test' });
test('compact WebView labels omit queries, fragments and duplicate URL titles', () => {
  const item = view('1', 'https://app.example.com/account?token=secret#private');
  assert.deepEqual(webViewLabel(item), { name: 'Portal', subtitle: 'app.example.com' });
  assert.equal(webViewLabel({ ...item, title: item.url }).name, 'app.example.com');
  assert.equal(webViewLabel(view('2', 'data:text/html,secret', '')).name, '');
  assert.equal(webViewLabel(view('3', 'invalid?secret', '')).subtitle, '');
});
test('matching WebViews get paths and collision-safe identifiers only when needed', () => {
  const a = view('sameprefix-a', 'https://app.example.com/account?x=1');
  const b = view('sameprefix-b', 'https://app.example.com/checkout');
  assert.equal(webViewLabel(a, [a,b]).subtitle, 'app.example.com · /account');
  const c = { ...b, url: a.url };
  assert.equal(webViewLabel(a, [a,c]).subtitle, 'app.example.com · /account · sameprefix-a');
});

test('message context URLs remain readable for long paths and inline documents', () => {
  assert.equal(compactContextUrl('https://example.org/cart?token=secret#address'), 'example.org/cart');
  const long = compactContextUrl('https://example.org/' + 'x'.repeat(300) + '/checkout');
  assert.ok(long.length <= 64 && long.includes('…') && long.endsWith('/checkout'));
  assert.equal(compactContextUrl('data:text/html,' + 'x'.repeat(200)), 'data:');
});

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

test('context labels distinguish retained and current frames with identical names and URLs', async () => {
  const { consoleContextLabels } = await import('../src/webview-label');
  const context = { key: 'old', name: 'checkout', url: 'https://example.com/pay', frame: 'child', top: false, depth: 1 };
  const labels = consoleContextLabels([context, { ...context, key: 'new' }]);
  assert.equal(labels.get('old'), 'checkout · example.com/pay · old');
  assert.equal(labels.get('new'), 'checkout · example.com/pay · new');
});

test('context choices use frame depth and current tree order after incremental discovery', async () => {
  const { consoleContextTreeLabel, retainConsoleContexts } = await import('../src/webview-label');
  const top = { key: 'top', name: '', url: '', frame: 'root', top: true, depth: 0 };
  const child = { ...top, key: 'child', frame: 'child', top: false, depth: 1 };
  const nested = { ...child, key: 'nested', depth: 2 };
  const sibling = { ...child, key: 'sibling' };
  assert.equal(consoleContextTreeLabel(top, 'top'), 'top');
  assert.equal(consoleContextTreeLabel(child, 'child'), '\u00a0\u00a0\u00a0↳ child');
  assert.equal(consoleContextTreeLabel(nested, 'nested'), '\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0↳ nested');
  assert.deepEqual(retainConsoleContexts([nested, child, top], [top, child, nested, sibling]), [top, child, nested, sibling]);
  assert.deepEqual(retainConsoleContexts([top, child, nested], [top, sibling]), [top, sibling, child, nested]);
});

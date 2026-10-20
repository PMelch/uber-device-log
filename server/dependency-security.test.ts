import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
test('Appium shell quoting rejects newline tokens after comments without executing a shell', () => {
  const fromAppium = createRequire(require.resolve('@appium/support'));
  const { quote } = fromAppium('shell-quote');
  assert.throws(() => quote(['echo', { comment: 'comment' }, 'first\nsecond']), TypeError);
});

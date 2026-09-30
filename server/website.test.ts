import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { websiteCatalogs } from '../src/i18n/website';
import { websiteTranslationContext } from '../src/i18n/context';
test('landing page copy is localized with context and remains outside the application bundle', () => {
  const keys = Object.keys(websiteCatalogs.en).sort();
  assert.deepEqual(Object.keys(websiteTranslationContext).sort(), keys);
  for (const catalog of Object.values(websiteCatalogs)) {
    assert.deepEqual(Object.keys(catalog).sort(), keys);
    for (const value of Object.values(catalog)) assert.ok(value.trim());
  }
  const html = readFileSync(new URL('../website/index.html', import.meta.url), 'utf8');
  for (const [, key] of html.matchAll(/data-(?:t|alt|label)="([^"]+)"/g)) assert.ok(keys.includes(key), key);
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.ok(!manifest.files.some((entry: string) => /website|site-dist|^\*$/.test(entry)));
});

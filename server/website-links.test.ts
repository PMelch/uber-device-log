import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { websiteRepositoryLinks } from '../scripts/website-links.mjs';

const html = readFileSync(new URL('../website/index.html', import.meta.url), 'utf8');
const prefix = 'https://github.com/PMelch/uber-device-log';

test('feature website links target the available branch; main builds keep main links', () => {
  for (const ref of ['feature/semantic-flows', 'main']) {
    const result = websiteRepositoryLinks(html, ref);
    assert.ok(result.includes(`${prefix}/tree/${ref}/blueprints`));
    for (const chapter of ['single-event', 'multipart', 'branching']) {
      assert.ok(result.includes(`${prefix}/blob/${ref}/tutorials/semantic-flows/${chapter}/README.md`));
    }
    assert.ok(result.includes(`${prefix}/blob/main/docs/technical.md`), 'unrelated existing links remain unchanged');
    if (ref === 'main') assert.equal(result, html);
  }
});

test('documentation refs cannot inject HTML and empty refs fail explicitly', () => {
  const result = websiteRepositoryLinks(html, 'feature/example"&<>');
  assert.ok(result.includes('/tree/feature/example%22%26%3C%3E/blueprints'));
  assert.throws(() => websiteRepositoryLinks(html, ''), /ref/i);
});

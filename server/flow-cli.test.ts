import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCliOptions } from './cli-options.js';
import { runBlueprintInstall } from './flow-cli.js';
import { fixtureBundle } from './fixtures/flow-bundle.js';
test('CLI install requires an explicit global or project target and preserves launch options', () => {
  assert.deepEqual(parseCliOptions(['install-blueprint','https://example.test/a.blueprint','--global']).install, { url: 'https://example.test/a.blueprint', scope: 'global' });
  assert.equal(parseCliOptions(['install-blueprint','https://example.test/a.blueprint','--project','.']).install?.scope, 'project');
  for (const args of [['install-blueprint'], ['install-blueprint','https://example.test/a.blueprint'], ['install-blueprint','x','--global','--project','.'], ['--global']]) assert.throws(() => parseCliOptions(args));
  assert.equal(parseCliOptions(['install-blueprint','--help']).help, true);
});
test('one-shot CLI installer uses the common operation without HTTP server or capture', async () => {
  const home = await mkdtemp(join(tmpdir(), 'udl-cli-home-'));
  try {
    const options = parseCliOptions(['install-blueprint','https://example.test/a.blueprint','--global']);
    const message = await runBlueprintInstall(options, { home, fetch: async () => new Response(new Uint8Array(fixtureBundle())) });
    assert.match(message, /Example bundle.*global/); assert.match(message, /[Dd]isabled/);
    assert.deepEqual(await readFile(join(home,'.udl/bundles/sample.blueprint')),fixtureBundle());
    await assert.rejects(runBlueprintInstall(options, { home, fetch: async () => new Response('broken') }));
  } finally { await rm(home,{recursive:true,force:true}); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCliOptions } from './cli-options.js';
import { runBlueprintInstall } from './flow-cli.js';
import { fixtureBundle } from './fixtures/flow-bundle.js';
test('CLI install requires an explicit global or project target and preserves launch options', () => {
  assert.deepEqual(parseCliOptions(['install-blueprint','https://example.test/a.blueprint','--global']).install, { source: 'https://example.test/a.blueprint', scope: 'global' });
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

test('CLI installs local files with spaces in both scopes without network access', async () => {
  const { writeFile, mkdir } = await import('node:fs/promises');
  const root = await mkdtemp(join(tmpdir(), 'udl-cli-file-'));
  try {
    const path = join(root, 'download with spaces.blueprint');
    await writeFile(path, fixtureBundle());
    await mkdir(join(root, 'project'));
    await mkdir(join(root, 'home'));
    const runtime = { home: join(root, 'home'), fetch: async () => { throw new Error('Unexpected network access'); } };
    for (const target of [['--global'], ['--project', join(root, 'project')]]) {
      const options = parseCliOptions(['install-blueprint', path, ...target]);
      assert.match(await runBlueprintInstall(options, runtime), /Disabled/);
      const installed = join(root, target[0] === '--global' ? 'home' : 'project', '.udl/bundles/sample.blueprint');
      assert.deepEqual(await readFile(installed), fixtureBundle());
      await assert.rejects(runBlueprintInstall(options, runtime), /already installed/);
      assert.deepEqual(await readFile(installed), fixtureBundle());
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('local installation rejects unsafe or invalid inputs without publishing', async () => {
  const { writeFile, mkdir, symlink, access } = await import('node:fs/promises');
  const { relative } = await import('node:path');
  const root = await mkdtemp(join(tmpdir(), 'udl-cli-reject-'));
  try {
    await writeFile(join(root, 'valid.blueprint'), fixtureBundle());
    await writeFile(join(root, 'invalid.blueprint'), 'invalid ZIP');
    await writeFile(join(root, 'large.blueprint'), Buffer.alloc(4 * 1024 * 1024 + 1));
    await writeFile(join(root, 'wrong.zip'), fixtureBundle());
    await symlink(join(root, 'valid.blueprint'), join(root, 'link.blueprint'));
    await mkdir(join(root, 'directory.blueprint'));
    for (const name of ['invalid.blueprint', 'large.blueprint', 'wrong.zip', 'link.blueprint', 'directory.blueprint', 'missing.blueprint']) {
      await assert.rejects(runBlueprintInstall(parseCliOptions(['install-blueprint', join(root, name), '--global']), { home: root }));
      await assert.rejects(access(join(root, '.udl/bundles/sample.blueprint')));
    }
    assert.match(await runBlueprintInstall(parseCliOptions(['install-blueprint', relative(process.cwd(), join(root, 'valid.blueprint')), '--global']), { home: root }), /Disabled/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

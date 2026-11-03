import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFlowBundle } from './flow-bundles.js';
import { bundleZip, fixtureBlueprint, fixtureBundle } from './fixtures/flow-bundle.js';
const config = { name: 'config.yaml', source: 'id: sample\nname: Sample bundle\ndescription: Example flow bundle\nspecVersion: 1\n' };
test('a bundle discovers all root YAML files without a manifest list', async () => {
  const value = await validateFlowBundle(bundleZip([config, { name: 'a.yaml', source: fixtureBlueprint('one') }, { name: 'b.yml', source: fixtureBlueprint('two') }]));
  assert.deepEqual(value.manifest, { id: 'sample', name: 'Sample bundle', description: 'Example flow bundle', specVersion: 1 });
  assert.deepEqual(value.blueprints.map(b => b.id), ['one', 'two']); assert.equal(value.files.length, 2);
});
test('invalid archive and manifest content never yields a partially valid bundle', async () => {
  for (const input of [Buffer.from('not zip'), fixtureBundle().subarray(0, 20), bundleZip([]), bundleZip([config]), bundleZip([{ ...config, source: 'id: sample\nname: Missing description\nspecVersion: 1\n' }, {name:'a.yaml',source:fixtureBlueprint()}]), ...['name: Missing\nspecVersion: 1', 'id: x\nname: X\nspecVersion: 2', 'id: ../x\nname: X\nspecVersion: 1', config.source + 'name: Duplicate\n', config.source + 'files: [flow.yaml]\n'].map(source => bundleZip([{ ...config, source }, { name: 'a.yaml', source: fixtureBlueprint() }]))]) await assert.rejects(validateFlowBundle(input));
});
test('unsafe ZIP paths, symlinks, unexpected files, CRC mismatches and duplicate IDs are rejected', async () => {
  for (const file of [{ name: '../escape.yaml' }, { name: '/absolute.yaml' }, { name: 'nested/flow.yaml' }, { name: 'flow.YAML' }, { name: 'script.js' }, { name: 'link.yaml', mode: 0o120777 }, { name: 'bad.yaml', crc: 0 }, { name: 'flow.draft.yaml' }]) await assert.rejects(validateFlowBundle(bundleZip([config, { ...file, source: fixtureBlueprint() }])));
  await assert.rejects(validateFlowBundle(bundleZip([config, config, { name: 'f.yaml', source: fixtureBlueprint() }])));
  await assert.rejects(validateFlowBundle(bundleZip([config, { name: 'a.yaml', source: fixtureBlueprint() }, { name: 'b.yaml', source: fixtureBlueprint() }])));
  await assert.rejects(validateFlowBundle(bundleZip([config, { name: 'a.yaml', source: fixtureBlueprint() }, { name: 'bad.yaml', source: 'invalid: true' }])));
});
test('bundle resource limits apply before and during decompression', async () => {
  await assert.rejects(validateFlowBundle(Buffer.alloc(4 * 1024 * 1024 + 1)), /limit|MiB/);
  await assert.rejects(validateFlowBundle(bundleZip([config, { name: 'big.yaml', source: 'x'.repeat(256 * 1024 + 1) }])), /limit|KiB/);
  await assert.rejects(validateFlowBundle(bundleZip([config, ...Array.from({ length: 101 }, (_, i) => ({ name: `f${i}.yaml`, source: fixtureBlueprint(`f${i}`) }))])), /limit|100/);
});

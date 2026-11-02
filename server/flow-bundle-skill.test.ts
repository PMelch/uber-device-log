import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { crc32 } from 'node:zlib';
import { validateFlowBundle } from './flow-bundles.js';
import { bundleZip, fixtureBlueprint, fixtureBundle } from './fixtures/flow-bundle.js';
const repository = fileURLToPath(new URL('../', import.meta.url));
const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
const execute = promisify(execFile);
const manifest = 'id: sample\nname: Sample bundle\ndescription: Fictional portable bundle\nspecVersion: 1\n';
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'udl-bundle-skill-')), skill = join(root, 'copied-skill'), source = join(root, 'source');
  await cp(join(repository, 'skills/udl-semantic-flows'), skill, { recursive: true }); await mkdir(source);
  const helper = join(skill, 'scripts/blueprint_bundle.py');
  assert.equal(await stat(helper).then(info => info.isFile(), () => false), true, 'The copied skill must include its portable bundle helper');
  const run = (...args: string[]) => execute(python, [helper, ...args], { cwd: root, timeout: 20000 });
  await writeFile(join(source, 'config.yaml'), manifest); await writeFile(join(source, 'flow.yaml'), fixtureBlueprint());
  return { root, source, run, close: () => rm(root, { recursive: true, force: true }) };
}
test('copied skill packages offline with honest validation status and validates through the actual viewer', async () => {
  const f = await fixture(); try {
    const output = join(f.root, 'sample.blueprint');
    const result = JSON.parse((await f.run('pack', f.source, output, '--structural-only')).stdout);
    assert.equal(result.structuralValidation, true); assert.equal(result.viewerValidation, 'not_run');
    const bytes = await readFile(output), parsed = await validateFlowBundle(bytes); assert.equal(parsed.manifest.description, 'Fictional portable bundle');
    const inspected = JSON.parse((await f.run('inspect', output)).stdout); assert.deepEqual(inspected.files, ['config.yaml', 'flow.yaml']); assert.equal(inspected.manifestSource, manifest);
    const validated = JSON.parse((await f.run('validate', output, '--viewer-root', repository)).stdout);
    assert.equal(validated.viewerValidation, 'passed'); assert.deepEqual(validated.blueprintIds, ['fixture']); assert.equal(validated.manifest.id, 'sample');
    assert.deepEqual(await readFile(output), bytes, 'Inspection and validation are read-only');
    await assert.rejects(f.run('pack', f.source, join(f.root, 'implicit.blueprint')), /viewer-root|structural-only/);
  } finally { await f.close(); }
});
test('existing bundle extension preserves the original archive, manifest and previous definition', async () => {
  const f = await fixture(); try {
    const original = join(f.root, 'original.blueprint'), bytes = fixtureBundle(); await writeFile(original, bytes);
    const staging = join(f.root, 'staging'); await f.run('unpack', original, staging);
    const config = await readFile(join(staging, 'config.yaml')), previous = await readFile(join(staging, 'flow.yaml'));
    await writeFile(join(staging, 'extra.yml'), fixtureBlueprint('additional'));
    const outputDirectory = join(f.root, 'rebuilt'); await mkdir(outputDirectory);
    const output = join(outputDirectory, 'sample.blueprint');
    const packed = JSON.parse((await f.run('pack', staging, output, '--viewer-root', repository)).stdout);
    assert.equal(packed.viewerValidation, 'passed'); assert.equal(packed.manifest.id, 'sample');
    const parsed = await validateFlowBundle(await readFile(output)); assert.deepEqual(parsed.blueprints.map(item => item.id).sort(), ['additional', 'fixture']);
    assert.deepEqual(await readFile(original), bytes); assert.deepEqual(await readFile(join(staging, 'config.yaml')), config); assert.deepEqual(await readFile(join(staging, 'flow.yaml')), previous);
    await assert.rejects(f.run('unpack', original, staging), /exist/);
    await assert.rejects(f.run('pack', staging, output, '--viewer-root', repository), /exist/);
    assert.deepEqual(await readFile(original), bytes);
  } finally { await f.close(); }
});
test('full bundle validation rejects malformed metadata, duplicate IDs and invalid DSL before publication', async () => {
  const f = await fixture(); try {
    const output = join(f.root, 'sample.blueprint');
    for (const config of [manifest.replace('description: Fictional portable bundle\n', ''), manifest.replace('specVersion: 1', 'specVersion: 2')]) {
      await writeFile(join(f.source, 'config.yaml'), config);
      await assert.rejects(f.run('pack', f.source, output, '--viewer-root', repository));
      assert.equal(await stat(output).then(() => true, () => false), false);
    }
    await writeFile(join(f.source, 'config.yaml'), manifest); await writeFile(join(f.source, 'duplicate.yaml'), fixtureBlueprint());
    await assert.rejects(f.run('pack', f.source, output, '--viewer-root', repository), /duplicate/i);
    await rm(join(f.source, 'duplicate.yaml')); await writeFile(join(f.source, 'flow.yaml'), 'version: 1\nid: invalid\n');
    await assert.rejects(f.run('pack', f.source, output, '--viewer-root', repository));
    assert.equal(await stat(output).then(() => true, () => false), false);
    await writeFile(join(f.source, 'flow.yaml'), fixtureBlueprint());
    await assert.rejects(f.run('pack', f.source, join(f.root, 'wrong.blueprint'), '--viewer-root', repository), /filename|manifest|id/i);
    assert.equal(await stat(join(f.root, 'wrong.blueprint')).then(() => true, () => false), false);
  } finally { await f.close(); }
});
test('portable helper rejects unsafe or damaged archives before creating an extraction directory', async () => {
  const f = await fixture(); try {
    const config = { name: 'config.yaml', source: manifest }, flow = { name: 'flow.yaml', source: fixtureBlueprint() };
    const cases = [
      bundleZip([config, { ...flow, name: '../escape.yaml' }]),
      bundleZip([config, { ...flow, name: '/absolute.yaml' }]),
      bundleZip([config, { ...flow, name: 'sub/flow.yaml' }]),
      bundleZip([config, { ...flow, name: 'flow.draft.yaml' }]),
      bundleZip([config, { ...flow, name: 'FLOW.YAML' }]),
      bundleZip([config, flow, flow]),
      bundleZip([config, { ...flow, mode: 0o120777 }]),
      bundleZip([config, { ...flow, crc: 0 }]),
      bundleZip([config, { ...flow, source: '#'.repeat(256 * 1024 + 1) }]),
      bundleZip([config, ...Array.from({ length: 101 }, (_, index) => ({ ...flow, name: `f${index}.yaml` }))]),
      bundleZip([flow]), Buffer.from('not a ZIP'),
    ];
    for (const [index, bytes] of cases.entries()) {
      const archive = join(f.root, `bad-${index}.blueprint`), target = join(f.root, `extract-${index}`); await writeFile(archive, bytes);
      await assert.rejects(f.run('unpack', archive, target)); assert.equal(await stat(target).then(() => true, () => false), false, `case ${index}`);
    }
    await writeFile(join(f.source, 'notes.txt'), 'Keep reports outside the bundle');
    await assert.rejects(f.run('pack', f.source, join(f.root, 'sample.blueprint'), '--structural-only'));
  } finally { await f.close(); }
});
test('portable helper rejects ZIP entries whose declared size and CRC hide additional content', async () => {
  const f = await fixture(); try {
    const prefix = '# prefix\n', source = prefix + '# hidden content\n'.repeat(100);
    for (const method of [0, 8]) {
      const bytes = bundleZip([{ name: 'config.yaml', source: manifest }, { name: 'flow.yaml', source, method }]);
      for (const [signature, nameOffset, crcOffset, sizeOffset] of [[0x04034b50, 30, 14, 22], [0x02014b50, 46, 16, 24]]) {
        const marker = Buffer.alloc(4); marker.writeUInt32LE(signature);
        for (let offset = bytes.indexOf(marker); offset !== -1; offset = bytes.indexOf(marker, offset + 4)) {
          if (bytes.subarray(offset + nameOffset, offset + nameOffset + 9).toString() === 'flow.yaml') {
            bytes.writeUInt32LE(crc32(Buffer.from(prefix)), offset + crcOffset);
            bytes.writeUInt32LE(Buffer.byteLength(prefix), offset + sizeOffset);
          }
        }
      }
      const archive = join(f.root, `forged-${method}.blueprint`), target = join(f.root, `forged-${method}`);
      await writeFile(archive, bytes);
      await assert.rejects(f.run('inspect', archive), /size|CRC|compressed/i);
      await assert.rejects(f.run('unpack', archive, target), /size|CRC|compressed/i);
      assert.equal(await stat(target).then(() => true, () => false), false);
    }
  } finally { await f.close(); }
});

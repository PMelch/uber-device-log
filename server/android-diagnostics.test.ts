import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { parseFlowBlueprint } from '../shared/flow-blueprints.js';
import { createFlowEngine } from '../shared/flow-engine.js';
import { flowPresentation } from '../shared/flow-presentation.js';
import { FlowProject } from './flow-project.js';
import { validateFlowBundle } from './flow-bundles.js';
import { androidDiagnosticBundles, androidDiagnosticCases, androidDiagnosticIds, androidDiagnosticNoise } from './fixtures/android-diagnostics.js';
import type { FlowBlueprint } from '../shared/flow-types.js';
const root = new URL('../blueprints/', import.meta.url);
async function definitions() {
  const result: FlowBlueprint[] = [];
  for (const bundle of androidDiagnosticBundles) {
    const directory = new URL(`${bundle}/`, root);
    const names = await readdir(directory).catch(() => []);
    for (const file of names.filter(name => name !== 'config.yaml' && name.endsWith('.yaml'))) {
      const parsed = parseFlowBlueprint(await readFile(new URL(file, directory), 'utf8'), file);
      assert.deepEqual(parsed.diagnostics, [], `${bundle}/${file}`); result.push(parsed.blueprint!);
    }
  }
  assert.deepEqual(result.map(item => item.id).sort(), [...androidDiagnosticIds].sort(), 'Ship the nine diagnostic definitions');
  return result;
}
test('Android diagnostics recognize source-derived variants as immediate single-record observations', async () => {
  const blueprints = await definitions();
  for (const { id, record, outcome, results } of androidDiagnosticCases) {
    const engine = createFlowEngine(() => 1000); engine.setBlueprints(blueprints, 'diagnostics'); engine.ingest([record]);
    const instances = engine.getState().instances;
    assert.equal(instances.length, 1, `${id}: ${record.message}`);
    const instance = instances[0]!;
    assert.equal(instance.blueprint.id, id); assert.equal(instance.outcome, outcome); assert.equal(instance.completeness, 'complete');
    assert.equal(instance.observations.length, 1); assert.deepEqual(instance.expected, []); assert.equal(instance.endedAt, instance.startedAt);
    const payload = instance.observations[0]!.payload;
    for (const [field, value] of Object.entries(results)) assert.equal(payload[field], value, `${id}.${field}`);
    assert.ok(flowPresentation(instance).label.length > 0); assert.ok(flowPresentation(instance).results.length > 0);
    assert.equal(instance.observations[0]!.message.message, record.message, 'Preserve the original evidence');
  }
});
test('Android diagnostics exclude noise, wrong origins and non-Android/non-device sources', async () => {
  const blueprints = await definitions(); const engine = createFlowEngine(() => 0); engine.setBlueprints(blueprints, 'diagnostics');
  engine.ingest(androidDiagnosticNoise);
  for (const { record } of androidDiagnosticCases) {
    engine.ingest([{ ...record, source: { ...record.source!, platform: 'ios' } }]);
    engine.ingest([{ ...record, source: { ...record.source!, webview: { id: 'page', socket: 'fixture', title: 'Fixture', url: 'https://example.test' } } }]);
  }
  assert.deepEqual(engine.getState().instances, []);
});
test('identical diagnostic records remain independent across repetitions, devices and ingest batches', async () => {
  const blueprints = await definitions();
  const records = androidDiagnosticCases.flatMap(({ record }) => [record, record, { ...record, source: { ...record.source!, deviceId: 'other' } }]);
  for (const batchSize of [1, records.length]) {
    const engine = createFlowEngine(() => 0); engine.setBlueprints(blueprints, 'diagnostics');
    for (let i = 0; i < records.length; i += batchSize) engine.ingest(records.slice(i, i + batchSize));
    const instances = engine.getState().instances;
    assert.equal(instances.length, records.length); assert.ok(instances.every(item => item.completeness === 'complete' && item.observations.length === 1 && item.outcome !== 'running'));
    assert.equal(instances.filter(item => item.deviceId === 'other').length, androidDiagnosticCases.length);
  }
});
test('shipped archives exactly match the source YAML and install disabled until explicitly enabled', async () => {
  await definitions();
  await promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/build-blueprint-bundles.mjs', '--check'], { cwd: fileURLToPath(new URL('../', import.meta.url)) });
  const temporary = await mkdtemp(join(tmpdir(), 'android-diagnostics-'));
  try {
    const home = join(temporary, 'home'), project = join(temporary, 'project'); await mkdir(home); await mkdir(join(project, '.udl/flows'), { recursive: true });
    const archives = new Map<string, Buffer>();
    for (const id of androidDiagnosticBundles) {
      const bytes = await readFile(new URL(`bundles/${id}.blueprint`, root));
      const parsed = await validateFlowBundle(bytes); assert.equal(parsed.manifest.id, id); assert.ok(parsed.manifest.description);
      archives.set(id, bytes);
    }
    const catalog = await FlowProject.create(project, { home, fetch: async input => new Response(new Uint8Array(archives.get(new URL(String(input)).pathname.slice(1, -10))!)) });
    for (const id of androidDiagnosticBundles) await catalog.installBundle(`https://example.test/${id}.blueprint`, 'project');
    let snapshot = await catalog.reload(); assert.deepEqual(snapshot.blueprints, []);
    for (const id of androidDiagnosticBundles) snapshot = await catalog.setBundleEnabled(`project:bundle:${id}`, true, snapshot.configRevision);
    assert.deepEqual(snapshot.diagnostics, []); assert.deepEqual(snapshot.blueprints.map(item => item.id).sort(), [...androidDiagnosticIds].sort());
    const engine = createFlowEngine(() => 0); engine.setBlueprints(snapshot.blueprints, snapshot.revision, snapshot);
    engine.ingest(androidDiagnosticCases.map(item => item.record)); assert.equal(engine.getState().instances.length, androidDiagnosticCases.length);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

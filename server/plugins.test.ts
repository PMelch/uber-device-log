import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeProject } from './project-context.js';
import { pairPlugin, loadPairedPlugins, parsePluginCommand } from './plugins.js';

function fixture(t: test.TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'udl-plugin-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return initializeProject(directory)!;
}
test('plugin pair accepts project syntax and rejects incomplete or unknown commands', () => {
  assert.equal(parsePluginCommand(['plugin', 'pair', 'stub', '--project=.'])?.name, 'stub');
  assert.equal(parsePluginCommand(['plugin', 'pair', 'stub', '--project', '.'])?.project, process.cwd());
  assert.equal(parsePluginCommand(['--project=.']), undefined);
  for (const args of [['plugin'], ['plugin', 'remove', 'stub'], ['plugin', 'pair', 'stub'], ['plugin', 'pair', 'stub', '--project=.', '--oops']]) assert.throws(() => parsePluginCommand(args));
});
test('pairing preserves config comments and settings, is repeatable and loads the selected value', t => {
  const project = fixture(t);
  writeFileSync(project.configPath, '# Keep this comment\nexample:\n  value: 0\nplugins:\n  stub:\n    configKey: example.value\n');
  assert.deepEqual(loadPairedPlugins(project), []);
  pairPlugin('stub', project.directory);
  const first = readFileSync(project.configPath, 'utf8');
  pairPlugin('stub', project.directory);
  assert.equal(readFileSync(project.configPath, 'utf8'), first);
  assert.match(first, /# Keep this comment/);
  assert.deepEqual(loadPairedPlugins(project), [{ name: 'stub', configKey: 'example.value', value: 0 }]);
});
test('default stub config pairs an empty project and loads only with project context', t => {
  const project = fixture(t);
  pairPlugin('stub', project.directory);
  assert.deepEqual(loadPairedPlugins(project), [{ name: 'stub', configKey: 'plugins.stub.value', value: 'Hello from stub' }]);
  assert.deepEqual(loadPairedPlugins(undefined), []);
});
test('unknown plugins and invalid config fail without modifying configuration', t => {
  const project = fixture(t);
  for (const content of ['plugins: []\n', 'plugins:\n  stub:\n    configKey: missing.key\n', 'plugins:\n  stub: false\n', 'bad: [\n']) {
    writeFileSync(project.configPath, content);
    assert.throws(() => pairPlugin('stub', project.directory));
    assert.equal(readFileSync(project.configPath, 'utf8'), content);
  }
  assert.throws(() => pairPlugin('../other', project.directory), /Unknown plugin/);
});

test('stub preserves scalar values and respects disabled pairing on reload', t => {
  const project = fixture(t);
  for (const scalar of ['false', '0', '\'\'', 'null']) {
    writeFileSync(project.configPath, `setting: ${scalar}\nplugins:\n  stub:\n    configKey: setting\n`);
    pairPlugin('stub', project.directory);
    assert.equal(loadPairedPlugins(project).length, 1);
  }
  writeFileSync(project.configPath, 'plugins:\n  stub:\n    paired: false\n');
  assert.deepEqual(loadPairedPlugins(project), []);
  for (const config of ['paired: yes', 'paired: true\n    configKey: missing', 'paired: true\n    configKey: plugins', 'paired: true\n    configKey: \"bad..key\"']) {
    writeFileSync(project.configPath, `plugins:\n  stub:\n    ${config}\n`);
    assert.throws(() => loadPairedPlugins(project));
  }
});

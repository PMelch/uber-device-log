import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeProject } from './project-context.js';

function fixture(t: test.TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'udl-project-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('without a project the instance has no project context', () => {
  assert.equal(initializeProject(), undefined);
});

test('initialization creates an empty config and retains the project paths', t => {
  const directory = fixture(t);
  const context = initializeProject(directory)!;
  assert.deepEqual(context, {
    directory,
    configDirectory: join(directory, '.udl'),
    configPath: join(directory, '.udl', 'config.yaml'),
  });
  assert.equal(readFileSync(context.configPath, 'utf8'), '');
  assert.equal(existsSync(join(directory, '.udl', 'flows')), false);
});

test('initialization is repeatable and preserves existing configuration verbatim', t => {
  const directory = fixture(t);
  mkdirSync(join(directory, '.udl'));
  const configPath = join(directory, '.udl', 'config.yaml');
  const contents = '# Project settings\nfutureSetting: custom\n';
  writeFileSync(configPath, contents);
  initializeProject(directory);
  initializeProject(directory);
  assert.equal(readFileSync(configPath, 'utf8'), contents);
});

test('an existing .udl directory receives a missing config', t => {
  const directory = fixture(t);
  mkdirSync(join(directory, '.udl'));
  initializeProject(directory);
  assert.equal(readFileSync(join(directory, '.udl', 'config.yaml'), 'utf8'), '');
});

test('invalid project paths fail without creating a project directory', t => {
  const directory = fixture(t);
  const missing = join(directory, 'missing');
  assert.throws(() => initializeProject(missing), /Unable to initialize project/);
  assert.equal(existsSync(missing), false);
  const file = join(directory, 'file');
  writeFileSync(file, 'preserve');
  assert.throws(() => initializeProject(file), /must be a directory/);
  assert.equal(readFileSync(file, 'utf8'), 'preserve');
});

test('file collisions fail without overwriting the existing path', t => {
  const directory = fixture(t);
  writeFileSync(join(directory, '.udl'), 'preserve');
  assert.throws(() => initializeProject(directory), /Unable to initialize project/);
  assert.equal(readFileSync(join(directory, '.udl'), 'utf8'), 'preserve');
});

test('a directory at config.yaml is rejected', t => {
  const directory = fixture(t);
  mkdirSync(join(directory, '.udl', 'config.yaml'), { recursive: true });
  assert.throws(() => initializeProject(directory), /config.yaml must be a regular file/);
});

test('a symlinked .udl directory cannot create configuration outside the project', t => {
  const directory = fixture(t);
  const target = fixture(t);
  symlinkSync(target, join(directory, '.udl'), 'junction');
  assert.throws(() => initializeProject(directory), /must be a directory, not a symlink/);
  assert.equal(existsSync(join(target, 'config.yaml')), false);
});

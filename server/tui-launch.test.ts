import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, rmSync, mkdirSync, copyFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function fixture() {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'udl-tui-cli-')));
  for (const child of ['bin', 'build/server', 'build/tui', 'runtime']) mkdirSync(join(directory, child), { recursive: true });
  writeFileSync(join(directory, 'package.json'), '{"type":"module","version":"0.11.1"}');
  copyFileSync('bin/uber-device-log.mjs', join(directory, 'bin/uber-device-log.mjs'));
  // The parser is unchanged; use the checked-in TypeScript through the test runner loader.
  copyFileSync('server/cli-options.ts', join(directory, 'build/server/cli-options.ts'));
  writeFileSync(join(directory, 'build/server/cli-options.js'), 'export { parseCliOptions } from "./cli-options.ts";');
  writeFileSync(join(directory, 'build/tui/index.js'), 'throw new Error("Only the Bun fixture should run");');
  return directory;
}
const posix = { skip: process.platform === 'win32' ? 'POSIX executable fixture' : false };
test('packaged TUI invokes Bun with its shipped entry and preserves project paths and exit codes', posix, () => {
  const directory = fixture();
  try {
    const bun = join(directory, 'runtime/bun');
    writeFileSync(bun, `#!${process.execPath}\nconsole.log(JSON.stringify(process.argv.slice(2)));\nprocess.exitCode = 7;\n`);
    chmodSync(bun, 0o755);
    const result = spawnSync(process.execPath, ['--import', 'tsx', join(directory, 'bin/uber-device-log.mjs'), '--tui', '--flows', 'project with spaces'], {
      encoding: 'utf8', env: { ...process.env, PATH: join(directory, 'runtime') },
    });
    assert.equal(result.status, 7, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), [join(directory, 'build/tui/index.js'), '--local', '--project', resolve('project with spaces')]);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('packaged TUI reports missing Bun without requiring a source checkout', posix, () => {
  const directory = fixture();
  try {
    const result = spawnSync(process.execPath, ['--import', 'tsx', join(directory, 'bin/uber-device-log.mjs'), '--tui'], {
      encoding: 'utf8', env: { ...process.env, PATH: join(directory, 'runtime') },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Bun.*required/);
    assert.doesNotMatch(result.stderr, /source checkout|build:tui/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

test('development TUI starts Bun source without a build and forwards project paths', { skip: process.platform === 'win32' ? 'POSIX executable fixture' : false }, () => {
  const directory = mkdtempSync(join(tmpdir(), 'udl-dev-'));
  try {
    const bun = join(directory, 'bun');
    writeFileSync(bun, `#!${process.execPath}\nconsole.log(JSON.stringify(process.argv.slice(2)));\nprocess.exitCode = 7;\n`); chmodSync(bun, 0o755);
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/dev.mjs', '--tui', '--flows', 'project with spaces', '--port', '4321'], {
      encoding: 'utf8', env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
    });
    assert.equal(result.status, 7, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), [resolve('tui/index.ts'), '--local', '--project', resolve('project with spaces')]);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('development help works without starting either interface', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/dev.mjs', '--tui', '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /--tui/);
});

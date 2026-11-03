import { test, expect } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('standalone flow registry and worker run outside the repository without node_modules', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'udl-flow-build-'));
  try {
    const executable = join(scratch, process.platform === 'win32' ? 'flows.exe' : 'flows');
    const fixture = fileURLToPath(new URL('./fixtures/flows-smoke.ts', import.meta.url));
    const worker = fileURLToPath(new URL('./flow-worker.ts', import.meta.url));
    execFileSync(process.execPath, ['build', '--compile', fixture, worker, '--outfile', executable], { stdio: 'pipe', timeout: 15000 });
    if (process.platform === 'darwin') execFileSync('codesign', ['--force', '--sign', '-', executable], { stdio: 'pipe' });
    const output = execFileSync(executable, [fileURLToPath(new URL('../test_flow_project', import.meta.url))], { cwd: scratch, encoding: 'utf8', timeout: 5000 });
    expect(output).toContain('flow project worker: completed');
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}, 25000);

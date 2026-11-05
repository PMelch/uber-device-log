import { rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
// Split chunks have content-based names; never ship obsolete chunks from an older build.
rmSync(new URL('../build/tui/', import.meta.url), { recursive: true, force: true });
const result = spawnSync('bun', ['build', './tui/index.ts', './tui/flow-worker.ts', '--target=bun', '--packages=external', '--splitting', '--outdir', 'build/tui'], { cwd: root, stdio: 'inherit' });
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;

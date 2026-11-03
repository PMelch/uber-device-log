import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { flowStyleFiles } from './style-scope.mjs';

const require = createRequire(import.meta.url);
const commands = {
  check: ['prettier', 'bin/prettier.cjs', '--check'],
  write: ['prettier', 'bin/prettier.cjs', '--write'],
  lint: ['eslint', 'bin/eslint.js', '--max-warnings=0'],
};
const command = commands[process.argv[2]];
if (!command || process.argv.length !== 3) {
  console.error('Usage: node scripts/check-style.mjs check|write|lint');
  process.exit(1);
}
const [packageName, executable, option] = command;
const script = join(dirname(require.resolve(`${packageName}/package.json`)), executable);
const result = spawnSync(process.execPath, [script, option, ...flowStyleFiles], {
  stdio: 'inherit',
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);

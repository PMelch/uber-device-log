import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseCliOptions } from '../server/cli-options.ts';

try {
  const args = process.argv.slice(2);
  const options = parseCliOptions(args, process.env.PORT);
  if (options.help) {
    console.log(`Über Device Log — development
Usage: npm run dev -- [options]
  --tui             Run the terminal interface directly from source (requires Bun)
  --project <dir>   Project directory
  --flows <dir>     Alias for --project
  --port <number>   Web server port; accepted but unused with --tui
  --help            Show help
  --version         Show package version

The web interface uses the tsx watcher. TUI changes take effect after restarting.`);
  } else if (options.version) {
    console.log(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);
  } else {
    const command = options.tui ? 'bun' : process.execPath;
    const childArgs = options.tui
      ? [fileURLToPath(new URL('../tui/index.ts', import.meta.url)), '--local', ...(options.project ? ['--project', options.project] : [])]
      : [fileURLToPath(import.meta.resolve('tsx/cli')), ...(options.install ? [] : ['watch']), fileURLToPath(new URL('../server/index.ts', import.meta.url)), ...args];
    const child = spawn(command, childArgs, { stdio: 'inherit' });
    const interrupt = () => child.kill('SIGINT');
    const terminate = () => child.kill('SIGTERM');
    process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
    await new Promise((resolve, reject) => {
      child.once('error', error => reject(options.tui && error.code === 'ENOENT'
        ? new Error('Bun is required for npm run dev -- --tui. Install Bun, then retry.') : error));
      child.once('exit', (code, signal) => { process.exitCode = code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1); resolve(); });
    }).finally(() => { process.off('SIGINT', interrupt); process.off('SIGTERM', terminate); });
  }
} catch (error) {
  console.error(`uber-device-log: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { parseCliOptions } from '../build/server/cli-options.js';

try {
  const options = parseCliOptions(process.argv.slice(2), process.env.PORT);
  if (options.help) {
    console.log(`Über Device Log — local Android and iOS log viewer

Usage: udl [options]
       uber-device-log [options]
       udl install-blueprint <file-or-url> --global
       udl install-blueprint <file-or-url> --project <dir>
       npx uber-device-log --port 4311
       bunx uber-device-log --port 4311

Options:
  -p, --port <number>  HTTP port (default: PORT environment variable or 4310)
      --tui           Terminal interface without a web server
      --project <dir> Project directory (creates .udl/config.yaml if missing)
      --flows <dir>   Alias for --project
  -h, --help           Show this help
  -v, --version        Show package version

Install globally: npm install --global uber-device-log
Then run: udl

Open the printed localhost URL in your browser. Press Ctrl+C to stop.
Requires Node.js 22.12+. Android needs adb; iOS needs host pairing/usbmuxd.
Only listens on 127.0.0.1. No account or credentials required.`);
  } else if (options.version) {
    console.log(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);
  } else if (options.install) {
    const { runBlueprintInstall } = await import('../build/server/flow-cli.js');
    console.log(await runBlueprintInstall(options));
  } else if (options.tui) {
    const binary = new URL(process.platform === 'win32' ? '../build/udl-tui.exe' : '../build/udl-tui', import.meta.url);
    if (!existsSync(binary)) throw new Error('TUI executable missing. From a source checkout run npm run build:tui first.');
    const child = spawn(fileURLToPath(binary), ['--local', ...(options.project ? ['--project', options.project] : [])], { stdio: 'inherit' });
    const forward = signal => child.kill(signal);
    const interrupt = () => forward('SIGINT');
    const terminate = () => forward('SIGTERM');
    process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
    await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', code => { process.exitCode = code ?? 1; resolve(); });
    }).finally(() => { process.off('SIGINT', interrupt); process.off('SIGTERM', terminate); });
  } else {
    process.env.PORT = String(options.port);
    process.argv.push('--production');
    await import('../build/server/index.js');
  }
} catch (error) {
  console.error(`uber-device-log: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

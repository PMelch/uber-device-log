#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseCliOptions } from '../build/server/cli-options.js';

try {
  const options = parseCliOptions(process.argv.slice(2), process.env.PORT);
  if (options.help) {
    console.log(`Über Device Log — local Android and iOS log viewer

Usage: udl [options]
       uber-device-log [options]
       npx uber-device-log --port 4311
       bunx uber-device-log --port 4311

Options:
  -p, --port <number>  HTTP port (default: PORT environment variable or 4310)
  -h, --help           Show this help
  -v, --version        Show package version

Install globally: npm install --global uber-device-log
Then run: udl

Open the printed localhost URL in your browser. Press Ctrl+C to stop.
Requires Node.js 22.12+. Android needs adb; iOS needs host pairing/usbmuxd.
Only listens on 127.0.0.1. No account or credentials required.`);
  } else if (options.version) {
    console.log(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);
  } else {
    process.env.PORT = String(options.port);
    process.argv.push('--production');
    await import('../build/server/index.js');
  }
} catch (error) {
  console.error(`uber-device-log: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

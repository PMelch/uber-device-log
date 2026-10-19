import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, existsSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('..', import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), 'uber-device-log-package-'));
const run = (command, args, cwd = root) => execFileSync(command, args, { cwd, encoding: 'utf8', timeout: 180000, stdio: ['ignore', 'pipe', 'pipe'] });
function inspectDependencySecurity(directory) {
  const found = new Set();
  function walk(path) {
    for (const item of readdirSync(path, { withFileTypes: true })) {
      if (!item.isDirectory()) continue;
      const child = join(path, item.name);
      const manifestPath = join(child, 'package.json');
      if (existsSync(manifestPath)) {
        const { name, version } = JSON.parse(readFileSync(manifestPath, 'utf8'));
        const minimum = { 'shell-quote': [1, 11, 0], 'source-map-js': [1, 2, 2] }[name];
        if (minimum) {
          found.add(name);
          const parts = version.split('.').map(Number);
          const firstDifference = minimum.findIndex((value, index) => parts[index] !== value);
          const patched = !version.includes('-') && (firstDifference === -1 || parts[firstDifference] > minimum[firstDifference]);
          if (name === 'shell-quote' && !patched) {
            console.warn(`KNOWN SECURITY FINDING: ${name}@${version}; Appium's upstream pin is not fixed by checkout overrides`);
          } else {
            assert.ok(patched, `${name}@${version} is vulnerable in installed package`);
            console.log(`PASS installed patched dependency: ${name}@${version}`);
          }
        }
      }
      walk(child);
    }
  }
  walk(directory);
  assert.ok(found.has('shell-quote'), 'Must inspect the installed Appium shell-quote dependency');
}
async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function smoke(command, args) {
  const port = await freePort();
  const child = spawn(command, [...args, '--port', String(port)], { cwd: temporary, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  let spawnError;
  child.on('error', error => { spawnError = error; });
  try {
    let response;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null) throw new Error(`${command} exited: ${output}`);
      try { response = await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(500) }); if (response.ok) break; } catch {}
      await delay(100);
    }
    assert.ok(response?.ok, `Server startup failed: ${output}`);
    const html = await response.text();
    assert.match(html, /Über Device Log/);
    const asset = html.match(/src="([^"]+\.js)"/)[1];
    assert.equal((await fetch(`http://127.0.0.1:${port}${asset}`)).status, 200);
    assert.equal((await fetch(`http://127.0.0.1:${port}/icons/android.svg`)).status, 200);
    const devices = await fetch(`http://127.0.0.1:${port}/api/devices`);
    assert.equal(devices.status, 200);
    assert.ok(Array.isArray((await devices.json()).devices));
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/devices`, { headers: { Origin: 'https://untrusted.example' } })).status, 403);
    console.log(`PASS ${command}: installed archive starts; UI, assets, discovery and origin guard work`);
  } finally {
    if (child.exitCode === null && !spawnError) {
      if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
      else process.kill(-child.pid, 'SIGTERM');
      const exited = await Promise.race([once(child, 'exit').then(() => true), delay(5000).then(() => false)]);
      if (!exited) {
        if (process.platform === 'win32') child.kill('SIGKILL');
        else { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
      }
    }
  }
}
try {
  run('npm', ['run', 'build']);
  const [pack] = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary]));
  assert.equal((pack.bundled || []).length, 0, 'Dependencies must be installed on the target host, not bundled');
  for (const file of pack.files) {
    assert.ok(/^(package\.json|README\.md|LICENSE|bin\/[^/]+\.mjs|build\/(server|shared)\/[^/]+\.js|dist\/.*)$/.test(file.path), `Unexpected package file: ${file.path}`);
    assert.ok(!/(^|\/)(\.env[^/]*|\.npmrc|.*\.(pem|key))$/.test(file.path), `Sensitive package file: ${file.path}`);
    assert.ok(!/\.test\.[^/]+$/.test(file.path), `Application test in archive: ${file.path}`);
  }
  console.log(`PASS archive allowlist: ${pack.files.length} files`);
  run('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', join(temporary, pack.filename)], temporary);
  const installed = join(temporary, 'node_modules', 'uber-device-log');
  inspectDependencySecurity(join(temporary, 'node_modules'));
  const manifest = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'));
  assert.equal(manifest.bin['uber-device-log'], 'bin/uber-device-log.mjs');
  assert.equal(manifest.bin.udl, manifest.bin['uber-device-log']);
  assert.ok(!existsSync(join(temporary, 'node_modules', 'vite')));
  assert.ok(!existsSync(join(temporary, 'node_modules', 'tsx')));
  assert.match(run('node', [join(installed, manifest.bin['uber-device-log']), '--help'], temporary), /Usage: udl/);
  assert.equal(run('node', [join(installed, manifest.bin['uber-device-log']), '--version'], temporary).trim(), manifest.version);
  await smoke('npx', ['--offline', '--no', '--', 'uber-device-log']);
  await smoke('bunx', ['--no-install', 'uber-device-log']);
  // bunx against an npm installation does not verify Bun's own dependency resolver.
  const bunDirectory = join(temporary, 'bun-install');
  mkdirSync(bunDirectory);
  writeFileSync(join(bunDirectory, 'package.json'), JSON.stringify({ name: 'bun-package-fixture', private: true }));
  run('bun', ['add', join(temporary, pack.filename)], bunDirectory);
  inspectDependencySecurity(join(bunDirectory, 'node_modules'));
  await smoke('node', [join(bunDirectory, 'node_modules/uber-device-log/bin/uber-device-log.mjs')]);
  const prefix = join(temporary, 'global');
  run('npm', ['install', '--global', '--prefix', prefix, '--omit=dev', '--no-audit', '--no-fund', join(temporary, pack.filename)], temporary);
  inspectDependencySecurity(join(prefix, process.platform === 'win32' ? 'node_modules' : 'lib/node_modules'));
  const globalCommand = join(prefix, process.platform === 'win32' ? 'udl.cmd' : 'bin/udl');
  assert.ok(existsSync(globalCommand), 'Global installation must expose udl');
  assert.equal(run(globalCommand, ['--version'], tmpdir()).trim(), manifest.version);
  assert.match(run(globalCommand, ['--help'], tmpdir()), /Usage: udl/);
  await smoke(globalCommand, []);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

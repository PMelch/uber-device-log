import assert from 'node:assert/strict';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { createServer as createHttpServer } from 'node:http';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, existsSync, cpSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isBuiltin } from 'node:module';
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
        const minimum = { 'shell-quote': [1, 11, 0], 'source-map-js': [1, 2, 2], 'follow-redirects': [1, 16, 1] }[name];
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
  assert.ok(found.has('follow-redirects'), 'Must inspect the installed Appium follow-redirects dependency');
}
async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function smoke(command, args, project, withFlows = false) {
  const port = await freePort();
  const child = spawn(command, [...args, '--port', String(port), ...(project ? ['--project', project] : [])], { cwd: temporary, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
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
    const snapshot = await (await fetch(`http://127.0.0.1:${port}/api/flows/snapshot`)).json();
    assert.equal(snapshot.enabled, true);
    assert.equal(snapshot.context, project ? 'project' : 'global');
    if (withFlows) { assert.ok(snapshot.blueprints.some(item => item.id === 'bank-transaction')); assert.equal(snapshot.diagnostics.length, 0); assert.ok(snapshot.blueprints.some(item => item.id === 'purchase')); }
    console.log(`PASS ${command}: installed archive starts; UI, assets, discovery, origin guard and ${withFlows ? 'project blueprints' : 'log-only mode'} work`);
    if (project && !withFlows) assert.equal(readFileSync(join(temporary, project, '.udl', 'config.yaml'), 'utf8'), '');
    else if (!project) assert.equal(existsSync(join(temporary, '.udl')), false);
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
async function smokeTui(command, args, installed) {
  // Pipes deliberately exercise real dependency/native loading and CLI forwarding,
  // then the TUI's non-interactive guard, without needing hardware or a terminal.
  await assert.rejects(promisify(execFile)(command, [...args, '--tui'], { cwd: temporary, timeout: 15000 }), error => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /An interactive terminal is required/);
    assert.doesNotMatch(error.stderr, /Cannot find|missing|ModuleNotFound|dlopen/);
    return true;
  });
  const workerPath = join(installed, 'build/tui/flow-worker.js');
  const script = `const worker = new Worker(${JSON.stringify(workerPath)});
    const timeout = setTimeout(() => { console.error('Worker timed out'); process.exit(1); }, 5000);
    worker.onerror = error => { console.error(error); process.exit(1); };
    worker.onmessage = ({ data }) => {
      if (data.error || data.id !== 1 || data.activatedRevision !== 'package-smoke') process.exit(1);
      console.log('Packaged flow worker activated'); clearTimeout(timeout); worker.terminate();
    };
    worker.postMessage({ id: 1, type: 'snapshot', blueprints: [], revision: 'package-smoke' });`;
  assert.match(run('bun', ['--eval', script], temporary), /Packaged flow worker activated/);
  console.log(`PASS ${command}: installed TUI loads native dependencies and its packaged flow worker`);
}

try {
  run('npm', ['run', 'build']);
  run('npm', ['run', 'build:tui:package']);
  const [pack] = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary]));
  assert.equal((pack.bundled || []).length, 0, 'Dependencies must be installed on the target host, not bundled');
  for (const file of pack.files) {
    assert.ok(/^(package\.json|README\.md|LICENSE|bin\/[^/]+\.mjs|build\/(server|shared|tui)\/[^/]+\.js|dist\/.*)$/.test(file.path), `Unexpected package file: ${file.path}`);
    assert.ok(!/(^|\/)(\.env[^/]*|\.npmrc|.*\.(pem|key))$/.test(file.path), `Sensitive package file: ${file.path}`);
    assert.ok(!/\.test\.[^/]+$/.test(file.path), `Application test in archive: ${file.path}`);
  }
  for (const path of ['build/tui/index.js', 'build/tui/flow-worker.js']) assert.ok(pack.files.some(file => file.path === path), `Missing TUI entry: ${path}`);
  console.log(`PASS archive allowlist: ${pack.files.length} files`);
  run('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', join(temporary, pack.filename)], temporary);
  const installed = join(temporary, 'node_modules', 'uber-device-log');
  inspectDependencySecurity(join(temporary, 'node_modules'));
  await smokeTui('node', [join(installed, 'bin/uber-device-log.mjs')], installed);
  const manifest = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'));
  // A transitive/peer install must not hide a missing direct TUI dependency.
  for (const entry of ['index.js', 'flow-worker.js']) {
    const source = readFileSync(join(installed, 'build/tui', entry), 'utf8');
    for (const [, specifier] of source.matchAll(/\bfrom ["']([^"']+)["']/g)) {
      if (specifier.startsWith('.') || isBuiltin(specifier) || specifier.startsWith('bun:')) continue;
      const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
      assert.ok(manifest.dependencies[name], `TUI imports undeclared runtime dependency: ${name}`);
    }
  }
  assert.equal(manifest.bin['uber-device-log'], 'bin/uber-device-log.mjs');
  assert.equal(manifest.bin.udl, manifest.bin['uber-device-log']);
  assert.ok(!existsSync(join(temporary, 'node_modules', 'vite')));
  assert.ok(!existsSync(join(temporary, 'node_modules', 'tsx')));
  assert.match(run('node', [join(installed, manifest.bin['uber-device-log']), '--help'], temporary), /Usage: udl/);
  assert.equal(run('node', [join(installed, manifest.bin['uber-device-log']), '--version'], temporary).trim(), manifest.version);
  assert.equal(manifest.dependencies.yauzl, '3.4.0');
  const bundle = readFileSync(join(root, 'test_flow_project/bundles/example.blueprint'));
  const download = createHttpServer((_request, response) => response.end(bundle));
  await new Promise(resolve => download.listen(0, '127.0.0.1', resolve));
  try {
    const target = join(temporary, 'bundle project');
    mkdirSync(target);
    const args = [join(installed, manifest.bin['uber-device-log']), 'install-blueprint', `http://127.0.0.1:${download.address().port}/example.blueprint`, '--project', target];
    const result = await promisify(execFile)('node', args, { cwd: temporary, timeout: 15000 });
    assert.match(result.stdout, /Installed Example operations.*Disabled/s);
    assert.deepEqual(readFileSync(join(target, '.udl/bundles/example.blueprint')), bundle);
    await assert.rejects(promisify(execFile)('node', args, { cwd: temporary, timeout: 15000 }), /already installed/);
    console.log('PASS installed one-shot CLI: validates and installs a bundle, reports disabled state and rejects replacement');
  } finally {
    download.closeAllConnections();
    await new Promise(resolve => download.close(resolve));
  }
  await smoke('npx', ['--offline', '--no', '--', 'uber-device-log']);
  await smokeTui('npx', ['--offline', '--no', '--', 'uber-device-log'], installed);
  await smokeTui('npx', ['--offline', '--no', '--', 'uber-device-log', '--'], installed);
  cpSync(join(root, 'test_flow_project'), join(temporary, 'fixture-project'), { recursive: true });
  await smoke('npx', ['--offline', '--no', '--', 'uber-device-log'], 'fixture-project', true);
  const project = 'example project';
  mkdirSync(join(temporary, project));
  assert.match(run('node', [join(installed, manifest.bin['uber-device-log']), '--help', '--project', project], temporary), /--project/);
  assert.equal(existsSync(join(temporary, project, '.udl')), false, 'Help must not initialize projects');
  await smoke('npx', ['--offline', '--no', '--', 'uber-device-log'], project);
  await smoke('bunx', ['--no-install', 'uber-device-log']);
  await smokeTui('bunx', ['--no-install', 'uber-device-log'], installed);
  await smokeTui('bunx', ['--no-install', 'uber-device-log', '--'], installed);
  // bunx against an npm installation does not verify Bun's own dependency resolver.
  const bunDirectory = join(temporary, 'bun-install');
  mkdirSync(bunDirectory);
  writeFileSync(join(bunDirectory, 'package.json'), JSON.stringify({ name: 'bun-package-fixture', private: true }));
  run('bun', ['add', join(temporary, pack.filename)], bunDirectory);
  inspectDependencySecurity(join(bunDirectory, 'node_modules'));
  await smoke('node', [join(bunDirectory, 'node_modules/uber-device-log/bin/uber-device-log.mjs')]);
  await smokeTui('node', [join(bunDirectory, 'node_modules/uber-device-log/bin/uber-device-log.mjs')], join(bunDirectory, 'node_modules/uber-device-log'));
  const prefix = join(temporary, 'global');
  run('npm', ['install', '--global', '--prefix', prefix, '--omit=dev', '--no-audit', '--no-fund', join(temporary, pack.filename)], temporary);
  inspectDependencySecurity(join(prefix, process.platform === 'win32' ? 'node_modules' : 'lib/node_modules'));
  const globalCommand = join(prefix, process.platform === 'win32' ? 'udl.cmd' : 'bin/udl');
  assert.ok(existsSync(globalCommand), 'Global installation must expose udl');
  assert.equal(run(globalCommand, ['--version'], tmpdir()).trim(), manifest.version);
  assert.match(run(globalCommand, ['--help'], tmpdir()), /Usage: udl/);
  await smoke(globalCommand, []);
  await smokeTui(globalCommand, [], join(prefix, process.platform === 'win32' ? 'node_modules/uber-device-log' : 'lib/node_modules/uber-device-log'));
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

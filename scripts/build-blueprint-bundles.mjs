// Run with node --import tsx. Stored ZIP entries make checked-in artifacts reproducible.
import { crc32 } from 'node:zlib';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { validateFlowBundle } from '../server/flow-bundles.ts';
const root = new URL('../blueprints/', import.meta.url);
const output = new URL('bundles/', root);
const check = process.argv.includes('--check');
if (process.argv.slice(2).some(arg => arg !== '--check')) throw new Error('Usage: node --import tsx scripts/build-blueprint-bundles.mjs [--check]');
function archive(files) {
  const locals = [], central = []; let offset = 0;
  for (const { name, bytes } of files) {
    const filename = Buffer.from(name), checksum = crc32(bytes);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(33, 12); // 1980-01-01
    local.writeUInt32LE(checksum, 14); local.writeUInt32LE(bytes.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(filename.length, 26);
    const entry = Buffer.alloc(46); entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(0x0314, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(33, 14);
    entry.writeUInt32LE(checksum, 16); entry.writeUInt32LE(bytes.length, 20); entry.writeUInt32LE(bytes.length, 24); entry.writeUInt16LE(filename.length, 28);
    entry.writeUInt32LE((0o100644 << 16) >>> 0, 38); entry.writeUInt32LE(offset, 42);
    locals.push(local, filename, bytes); central.push(entry, filename); offset += local.length + filename.length + bytes.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
const bundles = (await readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory() && entry.name !== 'bundles').map(entry => entry.name).sort();
if (!bundles.length) throw new Error('No Blueprint bundle source directories found.');
// Validate every output before writing any artifact.
const artifacts = await Promise.all(bundles.map(async name => {
  const directory = new URL(`${name}/`, root), entries = await readdir(directory, { withFileTypes: true });
  if (entries.some(entry => !entry.isFile() || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.ya?ml$/.test(entry.name))) throw new Error(`Only regular root YAML files are allowed in ${name}.`);
  const files = await Promise.all(entries.map(entry => entry.name).sort().map(async name => ({ name, bytes: await readFile(new URL(name, directory)) })));
  const bytes = archive(files), parsed = await validateFlowBundle(bytes);
  if (parsed.manifest.id !== name) throw new Error(`Manifest id must match source directory ${name}.`);
  return { name: `${name}.blueprint`, bytes };
}));
if (!check) await mkdir(output, { recursive: true });
for (const { name, bytes } of artifacts) {
  const target = new URL(name, output);
  if (check) {
    const current = await readFile(target).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (!current?.equals(bytes)) throw new Error(`Stale or missing ${fileURLToPath(target)}. Run npm run blueprints:build.`);
  } else await writeFile(target, bytes);
}
console.log(`${check ? 'Verified' : 'Built'} ${artifacts.length} validated Blueprint bundles.`);

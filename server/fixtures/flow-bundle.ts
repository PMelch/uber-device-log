import { crc32, deflateRawSync } from 'node:zlib';
/** ZIP fixture builder permits deliberately hostile names and metadata. */
export function bundleZip(files: { name: string; source: string; mode?: number; crc?: number; method?: number }[]): Buffer {
  const locals: Buffer[] = [], central: Buffer[] = []; let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name), raw = Buffer.from(file.source), method = file.method ?? 8;
    const bytes = method === 0 ? raw : deflateRawSync(raw);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(method, 8);
    header.writeUInt32LE(file.crc ?? crc32(raw), 14); header.writeUInt32LE(bytes.length, 18); header.writeUInt32LE(raw.length, 22); header.writeUInt16LE(name.length, 26);
    const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(0x0314, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(method, 10);
    directory.writeUInt32LE(file.crc ?? crc32(raw), 16); directory.writeUInt32LE(bytes.length, 20); directory.writeUInt32LE(raw.length, 24); directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE(((file.mode ?? 0o100644) << 16) >>> 0, 38); directory.writeUInt32LE(offset, 42);
    locals.push(header, name, bytes); central.push(directory, name); offset += header.length + name.length + bytes.length;
  }
  const index = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(index.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, index, end]);
}
export const fixtureBlueprint = (id = 'fixture') => JSON.stringify({ version: 1, id, name: id, start: 'start', timeout: '1m', correlation: { scope: 'device-session', primary: 'id' }, steps: [{ id: 'start', name: 'Start', match: { json: { path: 'event', equals: `${id}.start` } }, extract: { id: { json: 'id', required: true } }, next: ['done'] }, { id: 'done', name: 'Done', match: { json: { path: 'event', equals: `${id}.done` } }, extract: { id: { json: 'id', required: true } }, outcome: 'completed' }] });
export const fixtureBundle = (id = 'sample', blueprintId = 'fixture') => bundleZip([{ name: 'config.yaml', source: `id: ${id}\nname: Example bundle\ndescription: Example flow bundle\nspecVersion: 1\n` }, { name: 'flow.yaml', source: fixtureBlueprint(blueprintId) }]);

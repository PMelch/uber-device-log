import yauzlModule from 'yauzl';
import { crc32 } from 'node:zlib';
import { createHash } from 'node:crypto';
import type { EventEmitter } from 'node:events';
import type { Readable } from 'node:stream';
import { parseDocument } from 'yaml';
import { FLOW_FILE_LIMIT, parseFlowBlueprint } from '../shared/flow-blueprints.js';
import type { FlowBlueprint, FlowBlueprintFile } from '../shared/flow-types.js';
export const BUNDLE_FILE_LIMIT = 4 * 1024 * 1024;
export const BUNDLE_EXPANDED_LIMIT = 8 * 1024 * 1024;
export const bundleIdPattern = /^[a-z0-9][a-z0-9-]{0,79}$/;
export interface FlowBundleManifest { id: string; name: string; description: string; specVersion: 1 }
export interface ValidatedFlowBundle { manifest: FlowBundleManifest; blueprints: FlowBlueprint[]; files: FlowBlueprintFile[] }
interface Entry { fileName: string; uncompressedSize: number; crc32: number; compressionMethod: number; generalPurposeBitFlag: number; externalFileAttributes: number }
interface Zip extends EventEmitter { entryCount: number; readEntry(): void; close(): void; openReadStream(entry: Entry, callback: (error: Error | null, stream: Readable) => void): void }
const yauzl = yauzlModule as { fromBuffer(input: Buffer, options: object, callback: (error: Error | null, zip: Zip) => void): void };
export const flowHash = (source: string | Buffer) => createHash('sha256').update(source).digest('hex');
export function parseBundleManifest(source: string): FlowBundleManifest {
  const doc = parseDocument(source, { schema: 'core', uniqueKeys: true });
  if (doc.errors.length || doc.warnings.length) throw new Error('Invalid bundle config.yaml.');
  const value = doc.toJS({ maxAliasCount: 0 });
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['id', 'name', 'description', 'specVersion'].includes(key)) || typeof value.id !== 'string' || !bundleIdPattern.test(value.id) || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 200 || typeof value.description !== 'string' || !value.description.trim() || value.description.length > 2000 || value.specVersion !== 1) throw new Error('Bundle config.yaml requires a safe id, name, description and supported specVersion: 1.');
  return { id: value.id, name: value.name, description: value.description, specVersion: 1 };
}
/** The complete archive is validated in memory. No archive path is ever extracted. */
export async function validateFlowBundle(input: Buffer): Promise<ValidatedFlowBundle> {
  if (input.length > BUNDLE_FILE_LIMIT) throw new Error('Bundle exceeds the 4 MiB compressed limit.');
  const zip = await new Promise<Zip>((resolve, reject) => yauzl.fromBuffer(input, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, value) => error ? reject(error) : resolve(value)));
  const files = new Map<string, string>(); let expanded = 0;
  try {
    if (zip.entryCount < 2 || zip.entryCount > 101) throw new Error('A bundle requires config.yaml and 1–100 Blueprint files.');
    await new Promise<void>((resolve, reject) => {
      zip.on('error', reject); zip.on('end', resolve);
      zip.on('entry', (entry: Entry) => { void (async () => {
        const name = entry.fileName;
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.ya?ml$/.test(name) || /\.draft\.ya?ml$/i.test(name) || files.has(name)) throw new Error(`Unsafe, duplicate or unsupported bundle entry: ${name}`);
        const type = (entry.externalFileAttributes >>> 16) & 0xf000;
        if (type !== 0 && type !== 0x8000 || entry.generalPurposeBitFlag & 1 || ![0, 8].includes(entry.compressionMethod)) throw new Error(`Bundle entry must be an unencrypted regular file: ${name}`);
        if (entry.uncompressedSize > FLOW_FILE_LIMIT) throw new Error(`Bundle entry exceeds 256 KiB: ${name}`);
        expanded += entry.uncompressedSize;
        if (expanded > BUNDLE_EXPANDED_LIMIT) throw new Error('Bundle exceeds the 8 MiB expanded limit.');
        const stream = await new Promise<Readable>((done, fail) => zip.openReadStream(entry, (error, value) => error ? fail(error) : done(value)));
        const chunks: Buffer[] = []; let size = 0;
        for await (const chunk of stream) { size += chunk.length; if (size > FLOW_FILE_LIMIT || size > entry.uncompressedSize) { stream.destroy(); throw new Error(`Bundle entry exceeds its size limit: ${name}`); } chunks.push(chunk); }
        const bytes = Buffer.concat(chunks);
        if (size !== entry.uncompressedSize || crc32(bytes) !== entry.crc32) throw new Error(`Bundle entry size or CRC mismatch: ${name}`);
        const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        files.set(name, source); zip.readEntry();
      })().catch(reject); });
      zip.readEntry();
    });
  } finally { zip.close(); }
  if (!files.has('config.yaml')) throw new Error('Bundle is missing root config.yaml.');
  const manifest = parseBundleManifest(files.get('config.yaml')!);
  const blueprints: FlowBlueprint[] = [], sources: FlowBlueprintFile[] = [], ids = new Set<string>();
  for (const [filename, source] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    if (filename === 'config.yaml') continue;
    const result = parseFlowBlueprint(source, filename);
    if (!result.blueprint) throw new Error(`${filename}: ${result.diagnostics.map(item => item.message).join('; ')}`);
    if (ids.has(result.blueprint.id)) throw new Error(`Duplicate Blueprint ID in bundle: ${result.blueprint.id}`);
    ids.add(result.blueprint.id); blueprints.push(result.blueprint); sources.push({ filename, source, revision: flowHash(source) });
  }
  return { manifest, blueprints, files: sources };
}

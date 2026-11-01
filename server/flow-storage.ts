import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { parseProjectConfig, optionalStat, readBoundedSource, within, FlowProjectError } from './flow-directory.js';
import { bundleIdPattern, flowHash } from './flow-bundles.js';

/** Check every managed component; never follow a directory or final-file symlink. */
export async function managedDirectory(root: string, path: string, create = false): Promise<boolean> {
  if (!within(root, path) || path === root) throw new FlowProjectError('Managed directory must stay inside its root.');
  let current = root;
  for (const segment of relative(root, path).split(sep)) {
    current = resolve(current, segment);
    let stat = await optionalStat(current);
    if (!stat && create) { try { await mkdir(current); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; } stat = await lstat(current); }
    if (!stat) return false;
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new FlowProjectError('Managed directory must not contain symlinks or non-directories.');
  }
  if (!within(root, await realpath(path))) throw new FlowProjectError('Managed directory is outside its root.');
  return true;
}
export async function flowSettings(root: string) {
  const exists = await managedDirectory(root, resolve(root, '.udl'));
  const path = resolve(root, '.udl/config.yaml');
  const source = exists && await optionalStat(path) ? await readBoundedSource(path, '.udl/config.yaml') : '';
  const { doc, config } = parseProjectConfig(source, '.udl/config.yaml');
  const bundles = config.bundles ?? {};
  if (!bundles || typeof bundles !== 'object' || Array.isArray(bundles) || Object.keys(bundles).some(key => !['global', 'project'].includes(key))) throw new FlowProjectError('bundles must contain global/project activation mappings.');
  for (const scope of ['global', 'project']) {
    const entries = bundles[scope];
    if (entries !== undefined && (!entries || typeof entries !== 'object' || Array.isArray(entries) || Object.entries(entries).some(([id, value]) => !bundleIdPattern.test(id) || typeof value !== 'boolean'))) throw new FlowProjectError(`bundles.${scope} must map bundle IDs to booleans.`);
  }
  const bundleRevisions = config.bundleRevisions ?? {};
  if (!bundleRevisions || typeof bundleRevisions !== 'object' || Array.isArray(bundleRevisions) || Object.keys(bundleRevisions).some(key => !['global','project'].includes(key))) throw new FlowProjectError('Invalid bundle selection revisions.');
  for (const scope of ['global','project']) if (bundleRevisions[scope] !== undefined && (!bundleRevisions[scope] || typeof bundleRevisions[scope] !== 'object' || Array.isArray(bundleRevisions[scope]) || Object.entries(bundleRevisions[scope]).some(([id,value]) => !bundleIdPattern.test(id) || typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)))) throw new FlowProjectError('Invalid bundle selection revision.');
  const bundleEpochs = config.bundleEpochs ?? {};
  if (!bundleEpochs || typeof bundleEpochs !== 'object' || Array.isArray(bundleEpochs) || Object.keys(bundleEpochs).some(key => !['global','project'].includes(key))) throw new FlowProjectError('Invalid bundle activation generations.');
  for (const scope of ['global','project']) if (bundleEpochs[scope] !== undefined && (!bundleEpochs[scope] || typeof bundleEpochs[scope] !== 'object' || Array.isArray(bundleEpochs[scope]) || Object.entries(bundleEpochs[scope]).some(([id,value]) => !bundleIdPattern.test(id) || typeof value !== 'string' || !/^[a-f0-9]{32}$/.test(value)))) throw new FlowProjectError('Invalid bundle activation generation.');
  return { path, source, doc, bundleEpochs: bundleEpochs as { global?: Record<string, string>; project?: Record<string, string> }, bundleRevisions: bundleRevisions as { global?: Record<string, string>; project?: Record<string, string> }, bundles: bundles as { global?: Record<string, boolean>; project?: Record<string, boolean> }, revision: flowHash(source) };
}
export async function saveBundleSelection(root: string, scope: 'global' | 'project', id: string, enabled: boolean, revision: unknown, selectionRevision?: string) {
  await managedDirectory(root, resolve(root, '.udl'), true);
  const lock = resolve(root, '.udl/.bundle-config.lock');
  let handle;
  try { handle = await open(lock, 'wx', 0o600); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new FlowProjectError('Configuration is being changed. Reload and try again.', 409); throw error; }
  const temporary = resolve(root, `.udl/.config-${randomBytes(12).toString('hex')}.tmp`);
  try {
    const settings = await flowSettings(root);
    if (settings.revision !== revision) throw new FlowProjectError('Configuration changed. Reload before saving.', 409);
    if (enabled && (settings.bundles[scope]?.[id] !== true || settings.bundleRevisions[scope]?.[id] !== selectionRevision || !settings.bundleEpochs[scope]?.[id])) settings.doc.setIn(['bundleEpochs', scope, id], randomBytes(16).toString('hex'));
    settings.doc.setIn(['bundles', scope, id], enabled);
    if (selectionRevision) settings.doc.setIn(['bundleRevisions', scope, id], selectionRevision);
    const output = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    try { await output.writeFile(settings.doc.toString(), 'utf8'); await output.sync(); } finally { await output.close(); }
    await managedDirectory(root, resolve(root, '.udl'));
    if ((await flowSettings(root)).revision !== revision) throw new FlowProjectError('Configuration changed. Reload before saving.', 409);
    await rename(temporary, settings.path);
  } finally { await handle.close(); await unlink(lock).catch(() => {}); await unlink(temporary).catch(() => {}); }
}

/** Selection is bound to this installed file, not just a reusable bundle ID. */
export async function installedBundle(path: string) {
  const before = await lstat(path, { bigint: true });
  const { readBoundedBytes } = await import('./flow-directory.js');
  const { BUNDLE_FILE_LIMIT } = await import('./flow-bundles.js');
  const bytes = await readBoundedBytes(path, 'Bundle', BUNDLE_FILE_LIMIT);
  const after = await lstat(path, { bigint: true });
  if (after.isSymbolicLink() || before.ino !== after.ino || before.dev !== after.dev || before.mtimeNs !== after.mtimeNs || before.size !== after.size) throw new FlowProjectError('Bundle changed while being read. Reload and try again.', 409);
  const revision = flowHash(bytes);
  return { bytes, revision, selectionRevision: flowHash(`${after.dev}:${after.ino}:${after.birthtimeNs}:${revision}`) };
}

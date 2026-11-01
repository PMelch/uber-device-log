import { homedir } from 'node:os';
import { realpath, readdir, open, link, unlink } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { randomBytes } from 'node:crypto';
import express, { type Router } from 'express';
import { FlowDirectory, FlowProjectError, optionalStat, readBoundedBytes } from './flow-directory.js';
import { managedDirectory, flowSettings, saveBundleSelection, installedBundle } from './flow-storage.js';
import { BUNDLE_FILE_LIMIT, flowHash, validateFlowBundle, type ValidatedFlowBundle } from './flow-bundles.js';
import { downloadFlowBundle } from './flow-download.js';
import { flowDiagnostic, parseFlowBlueprint } from '../shared/flow-blueprints.js';
import type { FlowBlueprint, FlowDiagnostic, FlowSnapshot, FlowSource } from '../shared/flow-types.js';
export { FlowProjectError } from './flow-directory.js';
interface Options { home?: string; fetch?: typeof fetch }
/** Source registry and management facade; loose-file editing keeps its existing transaction boundary. */
export class FlowProject {
  private readonly token = randomBytes(32).toString('hex');
  private serial: Promise<unknown> = Promise.resolve();
  private readonly cache = new Map<string, { revision: string; value: ValidatedFlowBundle }>();
  private global?: FlowDirectory;
  private globalError?: string;
  private snapshot!: FlowSnapshot;
  private constructor(private readonly home: string, private readonly root: string | undefined, private readonly project: FlowDirectory | undefined, private readonly options: Options) {}
  static async create(directory?: string, options: Options = {}) {
    const home = await realpath(options.home ?? homedir());
    const project = directory === undefined ? undefined : await FlowDirectory.create(directory);
    const registry = new FlowProject(home, directory === undefined ? undefined : await realpath(directory), project, options);
    await registry.refresh(); return registry;
  }
  private queue<T>(action: () => Promise<T>): Promise<T> {
    const operation = this.serial.then(action, action); this.serial = operation.then(() => undefined, () => undefined); return operation;
  }
  private async refresh(): Promise<FlowSnapshot> {
    const diagnostics: FlowDiagnostic[] = [], sources: FlowSource[] = [];
    const definitions: FlowBlueprint[] = [], conflicts = new Set<string>();
    let settings: Awaited<ReturnType<typeof flowSettings>> | undefined;
    try { settings = await flowSettings(this.root ?? this.home); }
    catch (error) { diagnostics.push(flowDiagnostic(error instanceof Error ? error.message : String(error))); }
    if (!this.global) {
      try { this.global = await FlowDirectory.create(this.home, true); this.globalError = undefined; }
      catch (error) { this.globalError = error instanceof Error ? error.message : String(error); }
    }
    if (this.globalError) diagnostics.push(flowDiagnostic(this.globalError, 'global:config'));
    let editable: FlowSnapshot | undefined;
    const contexts = [{ root: this.home, scope: 'global' as const, directory: this.global }, ...(this.root && this.project ? [{ root: this.root, scope: 'project' as const, directory: this.project }] : [])];
    for (const context of contexts) {
      let expanded = 0;
      if (context.scope === 'global' && context.root === this.root) continue;
      if (context.directory) {
        const snapshot = await context.directory.reload();
        if (context.scope === 'project' || !this.root) editable = snapshot;
        const directoryExists = await optionalStat(resolve(context.root, snapshot.directory));
        const errors = directoryExists || context.scope === 'project' ? snapshot.diagnostics : snapshot.diagnostics.filter(item => !item.message.startsWith('Blueprint directory does not exist.'));
        const sourceId = `${context.scope}:loose`;
        const source: FlowSource = { id: sourceId, name: snapshot.directory, scope: context.scope, kind: 'loose', filename: snapshot.directory, enabled: true, revision: snapshot.revision, blueprintIds: snapshot.blueprints.map(item => item.id), activeBlueprintIds: [], diagnostics: errors };
        sources.push(source); diagnostics.push(...errors.map(item => ({ ...item, sourceId })));
        snapshot.conflictedBlueprintIds?.forEach(id => conflicts.add(id));
        definitions.push(...snapshot.blueprints.map(item => ({ ...item, sourceId })));
      }
      try {
        const directory = resolve(context.root, '.udl/bundles');
        if (!await managedDirectory(context.root, directory)) continue;
        const names = (await readdir(directory)).filter(name => name.endsWith('.blueprint')).sort();
        if (names.length > 32) throw new Error('At most 32 bundles per scope are supported.');
        for (const filename of names) {
          const id = `${context.scope}:bundle:${filename.slice(0, -10)}`;
          const source: FlowSource = { id, name: filename, scope: context.scope, kind: 'bundle', filename, revision: '', enabled: false, blueprintIds: [], activeBlueprintIds: [], diagnostics: [] };
          sources.push(source);
          try {
            const { bytes, revision, selectionRevision } = await installedBundle(resolve(directory, filename));
            const cached = this.cache.get(id);
            const parsed = cached?.revision === revision ? cached.value : await validateFlowBundle(bytes);
            if (filename !== `${parsed.manifest.id}.blueprint`) throw new Error('Bundle filename must match its manifest id.');
            expanded += parsed.files.reduce((sum, file) => sum + Buffer.byteLength(file.source), 0);
            if (expanded > 16 * 1024 * 1024) throw new Error('Bundle inventory exceeds the 16 MiB expanded limit.');
            this.cache.set(id, { revision, value: parsed });
            source.selectionRevision = selectionRevision;
            source.enabled = settings?.bundles[context.scope]?.[parsed.manifest.id] === true && settings.bundleRevisions[context.scope]?.[parsed.manifest.id] === selectionRevision;
            source.generation = settings?.bundleEpochs[context.scope]?.[parsed.manifest.id];
            source.name = parsed.manifest.name; source.description = parsed.manifest.description; source.specVersion = parsed.manifest.specVersion; source.revision = revision; source.blueprintIds = parsed.blueprints.map(item => item.id);
            if (source.enabled) definitions.push(...parsed.blueprints.map((item, index) => ({ ...item, sourceId: id, sourceFile: parsed.files[index]!.filename, sourceGeneration: source.generation })));
          } catch (error) { this.cache.delete(id); source.diagnostics.push(flowDiagnostic(error instanceof Error ? error.message : String(error), id)); diagnostics.push(...source.diagnostics); }
        }
      } catch (error) { diagnostics.push(flowDiagnostic(error instanceof Error ? error.message : String(error), `${context.scope}:bundles`)); }
    }
    const owners = new Map<string, string[]>();
    for (const definition of definitions) { const list = owners.get(definition.id) ?? []; list.push(`${definition.sourceId}/${definition.sourceFile ?? ''}`); owners.set(definition.id, list); }
    for (const [id, origins] of owners) if (origins.length > 1) { conflicts.add(id); diagnostics.push({ code: 'flowsSourceConflict', params: { id, sources: origins.join(', ') }, message: `Conflicting Blueprint ID ${id}: ${origins.join(', ')}. All affected definitions are inactive.` }); }
    let blueprints = definitions.filter(item => !conflicts.has(item.id));
    const inactiveSources = sources.filter(source => !source.enabled || source.diagnostics.length && source.kind === 'bundle').map(source => source.id);
    if (blueprints.length > 100 || Buffer.byteLength(JSON.stringify(blueprints)) > 8 * 1024 * 1024) {
      diagnostics.push(flowDiagnostic('Active sources exceed the 100-Blueprint or 8 MiB analysis limit. Disable bundles or reduce the active set.'));
      inactiveSources.push(...sources.map(source => source.id)); blueprints = [];
    }
    for (const source of sources) source.activeBlueprintIds = blueprints.filter(item => item.sourceId === source.id).map(item => item.id);
    const policy = { sourceGenerations: Object.fromEntries(sources.filter(source => source.enabled && source.generation).map(source => [source.id, source.generation!])), sourceIds: sources.map(source => source.id).sort(), inactiveSources: [...new Set(inactiveSources)].sort(), conflictedBlueprintIds: [...conflicts].sort() };
    const revision = flowHash(JSON.stringify({ blueprints, ...policy }));
    this.snapshot = { enabled: true, context: this.root ? 'project' : 'global', projectName: this.root ? basename(this.root) : '', directory: editable?.directory ?? '.udl/flows', revision, token: this.token, files: editable?.files ?? [], blueprints, sources, diagnostics, configRevision: settings?.revision, ...policy };
    for (const id of this.cache.keys()) if (!sources.some(source => source.id === id)) this.cache.delete(id);
    return this.snapshot;
  }
  reload() { return this.queue(() => this.refresh()); }
  save(filename: unknown, source: unknown, revision?: unknown, create = false) {
    return this.queue(async () => {
      let directory = this.project ?? this.global;
      if (!directory) throw new FlowProjectError('Global configuration is unavailable.');
      const result = await directory.save(filename, source, revision, create);
      if (result.diagnostics.length) return { diagnostics: result.diagnostics };
      return this.refresh();
    });
  }
  setBundleEnabled(sourceId: unknown, enabled: unknown, revision: unknown) {
    return this.queue(async () => {
      if (typeof sourceId !== 'string' || typeof enabled !== 'boolean') throw new FlowProjectError('A bundle source and boolean enabled value are required.');
      const snapshot = await this.refresh(); const source = snapshot.sources?.find(item => item.id === sourceId && item.kind === 'bundle');
      if (!source || source.diagnostics.length && enabled) throw new FlowProjectError('Select an installed, valid bundle.');
      await saveBundleSelection(this.root ?? this.home, source.scope, source.filename.slice(0, -10), enabled, revision, source.selectionRevision!);
      return this.refresh();
    });
  }
  installBundle(url: unknown, scope: unknown, signal?: AbortSignal) {
    return this.queue(async () => {
      if (scope !== 'global' && scope !== 'project') throw new FlowProjectError('Select global or project installation scope.');
      if (scope === 'project' && !this.root) throw new FlowProjectError('Project installation requires an explicit project directory.');
      const bytes = await downloadFlowBundle(url, this.options.fetch, signal);
      const parsed: ValidatedFlowBundle = await validateFlowBundle(bytes);
      signal?.throwIfAborted();
      const root = scope === 'global' ? this.home : this.root!; const directory = resolve(root, '.udl/bundles');
      await managedDirectory(root, resolve(root, '.udl'), true);
      const lock = resolve(root, '.udl/.bundles-install.lock');
      let lockHandle;
      try { lockHandle = await open(lock, 'wx', 0o600); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new FlowProjectError('Another bundle installation is publishing. Try again.', 409); throw error; }
      const target = resolve(directory, `${parsed.manifest.id}.blueprint`), temporary = resolve(directory, `.bundle-${randomBytes(12).toString('hex')}.tmp`);
      try {
        const exists = await managedDirectory(root, directory);
        const names = exists ? (await readdir(directory)).filter(name => name.endsWith('.blueprint')) : [];
        if (names.includes(`${parsed.manifest.id}.blueprint`)) throw new FlowProjectError('Bundle is already installed. Existing files were not changed.', 409);
        if (names.length >= 32) throw new FlowProjectError('Installing this bundle would exceed the 32-bundle scope limit.');
        let expanded = parsed.files.reduce((sum, file) => sum + Buffer.byteLength(file.source), 0);
        for (const name of names) {
          let existing: ValidatedFlowBundle;
          try { const input = await readBoundedBytes(resolve(directory, name), 'Bundle', BUNDLE_FILE_LIMIT); existing = await validateFlowBundle(input); }
          catch { continue; } // Invalid bundles contribute no loaded source content.
          expanded += existing.files.reduce((sum, file) => sum + Buffer.byteLength(file.source), 0);
          if (expanded > 16 * 1024 * 1024) throw new FlowProjectError('Installing this bundle would exceed the 16 MiB expanded scope inventory limit.');
        }
        signal?.throwIfAborted(); await managedDirectory(root, directory, true);
        const handle = await open(temporary, 'wx', 0o600);
        try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
        signal?.throwIfAborted(); await managedDirectory(root, directory);
        try { await link(temporary, target); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new FlowProjectError('Bundle is already installed. Existing files were not changed.', 409); throw error; }
      } finally { await unlink(temporary).catch(() => {}); await lockHandle.close(); await unlink(lock).catch(() => {}); }
      return this.refresh();
    });
  }
  router(): Router {
    const router = express.Router();
    router.use((_request, response, next) => { response.setHeader('Cache-Control', 'no-store'); next(); });
    router.get('/snapshot', async (_request, response, next) => { try { const result = await this.reload(); response.setHeader('ETag', `"${flowHash(JSON.stringify(result))}"`); response.json(result); } catch (error) { next(error); } });
    router.use((request, response, next) => {
      if (request.headers['x-flow-token'] !== this.token || !request.is('application/json')) { response.status(403).json({ diagnostics: [flowDiagnostic('Flow capability token and JSON content type are required.')] }); return; } next();
    });
    router.use(express.json({ limit: '300kb' }));
    router.post('/validate', (request, response) => {
      const { source, filename } = request.body ?? {}; if (typeof source !== 'string') { response.status(400).json({ diagnostics: [flowDiagnostic('Source must be a string.')] }); return; }
      response.json({ diagnostics: parseFlowBlueprint(source, typeof filename === 'string' ? filename : undefined).diagnostics });
    });
    router.post('/reload', async (_request, response) => response.json(await this.reload()));
    const save = (create: boolean) => async (request: express.Request, response: express.Response, next: express.NextFunction) => {
      try { const result = await this.save(create ? request.body?.filename : request.params.filename, request.body?.source, request.body?.revision, create); response.status('files' in result ? 200 : 422).json(result); } catch (error) { next(error); }
    };
    router.post('/blueprints', save(true)); router.put('/blueprints/:filename', save(false));
    router.post('/bundles/activation', async (request, response, next) => {
      try { response.json(await this.setBundleEnabled(request.body?.sourceId, request.body?.enabled, request.body?.revision)); } catch (error) { next(error); }
    });
    router.post('/bundles/install', async (request, response, next) => {
      const controller = new AbortController(); response.once('close', () => { if (!response.writableEnded) controller.abort(); });
      try { response.json(await this.installBundle(request.body?.url, request.body?.scope, controller.signal)); } catch (error) { next(error); }
    });
    router.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => { response.status(error instanceof FlowProjectError ? error.status : 400).json({ diagnostics: [{ code: 'flowsBundleError', params: { detail: error instanceof Error ? error.message : String(error) }, message: error instanceof Error ? error.message : String(error) }] }); });
    return router;
  }
}

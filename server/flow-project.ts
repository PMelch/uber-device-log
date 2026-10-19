import { randomBytes, createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, readdir, realpath, rename, unlink, open } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import express, { type Router } from 'express';
import { parseDocument } from 'yaml';
import { FLOW_FILE_LIMIT, flowDiagnostic, parseFlowBlueprint } from '../shared/flow-blueprints.js';
import type { FlowBlueprint, FlowBlueprintFile, FlowSnapshot } from '../shared/flow-types.js';
const hash = (source: string) => createHash('sha256').update(source).digest('hex');
const within = (root: string, path: string) => { const p = relative(root, path); return p === '' || (!p.startsWith(`..${sep}`) && p !== '..' && !isAbsolute(p)); };
export class FlowProjectError extends Error { constructor(message: string, public status = 400) { super(message); } }
async function readBoundedSource(path: string, label: string) {
  const before = await lstat(path);
  if (before.isSymbolicLink() || !before.isFile()) throw new FlowProjectError(`${label} must be a regular file, not a symlink.`);
  if (before.size > FLOW_FILE_LIMIT) throw new FlowProjectError(`${label} exceeds 256 KiB.`);
  // NONBLOCK prevents a replacement FIFO from hanging open; NOFOLLOW rejects
  // replacement symlinks. Validate the opened descriptor before reading it.
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = await handle.stat();
    if (!opened.isFile()) throw new FlowProjectError(`${label} must be a regular file.`);
    if (opened.size > FLOW_FILE_LIMIT) throw new FlowProjectError(`${label} exceeds 256 KiB.`);
    // Read at most limit+1 bytes even if an external writer grows the file.
    const buffer = Buffer.alloc(FLOW_FILE_LIMIT + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > FLOW_FILE_LIMIT) throw new FlowProjectError(`${label} exceeds 256 KiB.`);
    return buffer.toString('utf8', 0, length);
  } finally { await handle.close(); }
}
export class FlowProject {
  private token = randomBytes(32).toString('hex');
  private snapshot: FlowSnapshot;
  private serial: Promise<unknown> = Promise.resolve();
  private constructor(private projectRoot?: string, private blueprintDirectory?: string) {
    this.snapshot = { enabled: !!projectRoot, projectName: projectRoot ? basename(projectRoot) : '', directory: blueprintDirectory && projectRoot ? relative(projectRoot, blueprintDirectory) : '', revision: hash('[]'), token: this.token, blueprints: [], files: [], diagnostics: [] };
  }
  static async create(directory?: string) {
    if (directory === undefined) return new FlowProject();
    const root = await realpath(resolve(directory));
    if (!(await lstat(root)).isDirectory()) throw new Error(`Flow project is not a directory: ${directory}`);
    const configFile = resolve(root, '.flowsrc');
    const source = await readBoundedSource(configFile, '.flowsrc');
    const doc = parseDocument(source, { schema: 'core', uniqueKeys: true });
    if (doc.errors.length || doc.warnings.length) throw new Error(`Invalid .flowsrc: ${[...doc.errors, ...doc.warnings].map(e => e.message).join('; ')}`);
    // toJS rejects aliases even in otherwise empty configuration.
    const config = doc.toJS({ maxAliasCount: 0 }) ?? {};
    if (typeof config !== 'object' || Array.isArray(config) || Object.keys(config).some(k => k !== 'blueprints') || (config.blueprints !== undefined && (typeof config.blueprints !== 'string' || !config.blueprints.trim()))) throw new Error('.flowsrc supports only blueprints: <relative directory>.');
    const path = resolve(root, config.blueprints ?? '.flows');
    if (!within(root, path) || path === root) throw new Error('Blueprint directory must be inside the project root.');
    const project = new FlowProject(root, path);
    await project.safeDirectory(false);
    await project.reload();
    return project;
  }
  private async safeDirectory(create: boolean) {
    if (!this.projectRoot || !this.blueprintDirectory) throw new FlowProjectError('No flow project configured.', 409);
    let cursor = this.projectRoot;
    for (const segment of relative(this.projectRoot, this.blueprintDirectory).split(sep)) {
      cursor = resolve(cursor, segment);
      try { const stat = await lstat(cursor); if (stat.isSymbolicLink() || !stat.isDirectory()) throw new FlowProjectError('Blueprint directory must not contain symlinks or non-directories.'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; if (create) await mkdir(cursor); else return false; }
    }
    if (!within(this.projectRoot, await realpath(this.blueprintDirectory))) throw new FlowProjectError('Blueprint directory is outside the project.');
    return true;
  }
  private filename(value: unknown): string {
    if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.ya?ml$/.test(value)) throw new FlowProjectError('Use a plain .yaml or .yml filename (maximum 125 characters).');
    if (/\.draft\.ya?ml$/i.test(value)) throw new FlowProjectError('Draft filenames are inactive. Remove .draft before saving an active blueprint.');
    return value;
  }
  private async file(filename: string) {
    const path = resolve(this.blueprintDirectory!, this.filename(filename));
    const source = await readBoundedSource(path, 'Blueprint');
    return { filename, source, revision: hash(source) };
  }
  private async scan(replace?: FlowBlueprintFile) {
    const diagnostics = [];
    const files: FlowBlueprintFile[] = [];
    const blueprints: FlowBlueprint[] = [];
    const ids = new Set<string>();
    if (!await this.safeDirectory(false)) return { files, blueprints, diagnostics: [flowDiagnostic('Blueprint directory does not exist. Save a new blueprint to create it.')] };
    const names = (await readdir(this.blueprintDirectory!)).filter(n => /\.ya?ml$/.test(n) && !/\.draft\.ya?ml$/i.test(n)).sort();
    if (replace && !names.includes(replace.filename)) names.push(replace.filename);
    if (names.length > 100) return { files, blueprints, diagnostics: [flowDiagnostic('At most 100 blueprint files are allowed.')] };
    for (const filename of names.sort()) {
      try {
        const file = filename === replace?.filename ? replace : await this.file(filename);
        files.push(file);
        const parsed = parseFlowBlueprint(file.source, filename);
        diagnostics.push(...parsed.diagnostics);
        if (parsed.blueprint) {
          if (ids.has(parsed.blueprint.id)) diagnostics.push(flowDiagnostic(`Duplicate blueprint ID: ${parsed.blueprint.id}`, filename));
          else { ids.add(parsed.blueprint.id); blueprints.push(parsed.blueprint); }
        }
      } catch (error) { diagnostics.push(flowDiagnostic(error instanceof Error ? error.message : String(error), filename)); }
    }
    return { files, blueprints, diagnostics };
  }
  private async refresh() {
    if (!this.projectRoot) return this.snapshot;
    try {
      const scanned = await this.scan();
      const revision = hash(JSON.stringify(scanned.files.map(f => [f.filename, f.revision])));
      this.snapshot = { ...this.snapshot, files: scanned.files, diagnostics: scanned.diagnostics, ...(scanned.diagnostics.length ? {} : { blueprints: scanned.blueprints, revision }) };
    } catch (error) { this.snapshot = { ...this.snapshot, diagnostics: [flowDiagnostic(error instanceof Error ? error.message : String(error))] }; }
    return this.snapshot;
  }
  private queue<T>(action: () => Promise<T>): Promise<T> {
    const operation = this.serial.then(action, action);
    this.serial = operation.then(() => undefined, () => undefined);
    return operation;
  }
  reload() { return this.queue(() => this.refresh()); }
  async save(filenameValue: unknown, sourceValue: unknown, revision?: unknown, create = false) {
    return this.queue(async () => {
      const filename = this.filename(filenameValue);
      if (typeof sourceValue !== 'string' || Buffer.byteLength(sourceValue) > FLOW_FILE_LIMIT) throw new FlowProjectError('Source must be a string of at most 256 KiB.');
      const parsed = parseFlowBlueprint(sourceValue, filename);
      if (parsed.diagnostics.length) return { diagnostics: parsed.diagnostics };
      await this.safeDirectory(true);
      let old: FlowBlueprintFile | undefined;
      try { old = await this.file(filename); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (create ? !!old : !old || typeof revision !== 'string' || old.revision !== revision) throw new FlowProjectError('Blueprint changed or already exists. Reload before saving.', 409);
      const candidate = { filename, source: sourceValue, revision: hash(sourceValue) };
      const scanned = await this.scan(candidate);
      if (scanned.diagnostics.length) return { diagnostics: scanned.diagnostics };
      const target = resolve(this.blueprintDirectory!, filename);
      const temporary = resolve(dirname(target), `.flow-${randomBytes(12).toString('hex')}.tmp`);
      const handle = await open(temporary, 'wx', 0o600);
      try { await handle.writeFile(sourceValue, 'utf8'); await handle.sync(); } finally { await handle.close(); }
      try {
        await this.safeDirectory(false);
        if (create) {
          // Link performs an exclusive atomic create; an external file cannot be overwritten.
          const { link } = await import('node:fs/promises');
          try { await link(temporary, target); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new FlowProjectError('Blueprint already exists.', 409); throw error; }
        } else {
          const current = await this.file(filename);
          if (current.revision !== revision) throw new FlowProjectError('Blueprint changed. Reload before saving.', 409);
          await rename(temporary, target);
        }
      } finally { await unlink(temporary).catch(() => {}); }
      return this.refresh();
    });
  }
  router(): Router {
    const router = express.Router();
    router.use((_request, response, next) => { response.setHeader('Cache-Control', 'no-store'); next(); });
    router.get('/snapshot', async (_request, response) => {
      const snapshot = await this.reload();
      response.setHeader('ETag', `"${hash(JSON.stringify(snapshot))}"`);
      response.json(snapshot);
    });
    router.use((request, response, next) => {
      if (request.headers['x-flow-token'] !== this.token || !request.is('application/json')) { response.status(403).json({ diagnostics: [flowDiagnostic('Flow capability token and JSON content type are required.')] }); return; }
      next();
    });
    router.use(express.json({ limit: '300kb' }));
    router.post('/validate', (request, response) => {
      const { source, filename } = request.body ?? {};
      if (typeof source !== 'string') { response.status(400).json({ diagnostics: [flowDiagnostic('Source must be a string.')] }); return; }
      response.json({ diagnostics: parseFlowBlueprint(source, typeof filename === 'string' ? filename : undefined).diagnostics });
    });
    router.post('/reload', async (_request, response) => response.json(await this.reload()));
    const save = (create: boolean) => async (request: express.Request, response: express.Response) => {
      try {
        const result = await this.save(create ? request.body?.filename : request.params.filename, request.body?.source, request.body?.revision, create);
        response.status(result.diagnostics.length ? 422 : 200).json(result);
      } catch (error) { response.status(error instanceof FlowProjectError ? error.status : 400).json({ diagnostics: [flowDiagnostic(error instanceof Error ? error.message : String(error))] }); }
    };
    router.post('/blueprints', save(true));
    router.put('/blueprints/:filename', save(false));
    router.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => { response.status(400).json({ diagnostics: [flowDiagnostic(error instanceof Error ? error.message : String(error))] }); });
    return router;
  }
}

import { closeSync, constants, fstatSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { isMap, parseDocument } from 'yaml';
import { initializeProject, type ProjectContext } from './project-context.js';
import { createStubPlugin } from './plugin-stub.js';

export function parsePluginCommand(args: string[]) {
  if (args[0] !== 'plugin') return undefined;
  if (args[1] !== 'pair' || !args[2] || args[2].startsWith('-')) throw new Error('Usage: udl plugin pair <pluginname> --project=<folder>');
  let project: string | undefined;
  for (let i = 3; i < args.length; i++) {
    const arg = args[i]!;
    if (project !== undefined || (arg !== '--project' && !arg.startsWith('--project='))) throw new Error(`Unknown plugin argument: ${arg}`);
    const value = arg === '--project' ? args[++i] : arg.slice(10);
    if (!value || value.startsWith('-')) throw new Error('--project requires a project directory.');
    project = resolve(value);
  }
  if (!project) throw new Error('Plugin pairing requires --project=<folder>.');
  return { name: args[2], project };
}

function readConfig(project: ProjectContext) {
  const fd = openSync(project.configPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 1024 * 1024) throw new Error('Invalid project configuration file.');
    const document = parseDocument(readFileSync(fd, 'utf8'));
    if (document.errors.length) throw new Error('Invalid project YAML.');
    if (document.contents !== null && !isMap(document.contents)) throw new Error('Project configuration must be a mapping.');
    const plugins = document.get('plugins', true);
    if (plugins !== undefined && !isMap(plugins)) throw new Error('plugins must be a mapping.');
    return { document, mode: stat.mode & 0o777 };
  } finally { closeSync(fd); }
}

export function pairPlugin(name: string, directory: string) {
  if (name !== 'stub') throw new Error(`Unknown plugin: ${name}. Available plugins: stub.`);
  const project = initializeProject(directory)!;
  const { document, mode } = readConfig(project);
  const stub = document.getIn(['plugins', 'stub'], true);
  if (stub !== undefined && !isMap(stub)) throw new Error('plugins.stub must be a mapping.');
  if (!document.hasIn(['plugins', 'stub', 'configKey'])) {
    document.setIn(['plugins', 'stub', 'configKey'], 'plugins.stub.value');
    if (!document.hasIn(['plugins', 'stub', 'value'])) document.setIn(['plugins', 'stub', 'value'], 'Hello from stub');
  }
  createStubPlugin(document); // Validate before modifying the project file.
  document.setIn(['plugins', 'stub', 'paired'], true);
  const temporary = project.configPath + '.' + randomUUID() + '.tmp';
  try {
    writeFileSync(temporary, String(document), { flag: 'wx', mode });
    renameSync(temporary, project.configPath);
  } finally {
    try { unlinkSync(temporary); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  return project;
}

export function loadPairedPlugins(project: ProjectContext | undefined) {
  if (!project) return [];
  const { document } = readConfig(project);
  const paired = document.getIn(['plugins', 'stub', 'paired']);
  if (paired === undefined || paired === false) return [];
  if (paired !== true) throw new Error('plugins.stub.paired must be a boolean.');
  return [createStubPlugin(document)];
}

import { lstatSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface ProjectContext {
  directory: string;
  configDirectory: string;
  configPath: string;
}

export function initializeProject(project?: string): ProjectContext | undefined {
  if (project === undefined) return undefined;
  const directory = resolve(project);
  const configDirectory = join(directory, '.udl');
  const configPath = join(configDirectory, 'config.yaml');
  try {
    if (!statSync(directory).isDirectory()) throw new Error('Project path must be a directory.');
    mkdirSync(configDirectory, { recursive: true });
    const configDirectoryStat = lstatSync(configDirectory);
    if (configDirectoryStat.isSymbolicLink() || !configDirectoryStat.isDirectory()) throw new Error('.udl must be a directory, not a symlink.');
    try {
      writeFileSync(configPath, '', { flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    if (!lstatSync(configPath).isFile()) throw new Error('Project config.yaml must be a regular file.');
  } catch (error) {
    throw new Error(`Unable to initialize project "${directory}": ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  return { directory, configDirectory, configPath };
}

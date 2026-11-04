import { readdir, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { FlowProject } from '../server/flow-project';
import type { FlowDiagnostic, FlowSource, FlowSnapshot } from '../shared/flow-types';
import type { UiMessage } from '../src/i18n';

type Registry = Pick<FlowProject, 'setBundleEnabled' | 'installBundle' | 'installBundleFile'>;
export function createFlowSources(options: { project(): Promise<Registry>; changed(): Promise<void> }) {
  let busy: 'install' | 'activation' | undefined, status: UiMessage | undefined;
  let diagnostics: FlowDiagnostic[] = [], controller: AbortController | undefined, disposed = false;
  const listeners = new Set<() => void>();
  const notify = () => { if (!disposed) for (const listener of listeners) listener(); };
  async function run(kind: 'install' | 'activation', action: (project: Registry, signal: AbortSignal) => Promise<unknown>) {
    if (busy || disposed) return;
    busy = kind; diagnostics = []; status = kind === 'install' ? { code: 'flowsBundleInstalling' } : undefined;
    const operation = new AbortController(); controller = operation; notify();
    try {
      const project = await options.project(); operation.signal.throwIfAborted();
      await action(project, operation.signal);
      status = { code: kind === 'install' ? 'flowsBundleInstalled' : 'flowsBundleSaved' };
    } catch (error) {
      if (operation.signal.aborted) status = { code: 'flowsBundleCancelled' };
      else {
        const detail = error instanceof Error ? error.message : String(error);
        status = { code: (error as { status?: number })?.status === 409 ? 'flowsConflict' : 'flowsBundleError', params: { detail } };
        diagnostics = [{ code: 'flowsBundleError', params: { detail }, message: detail }];
      }
    } finally {
      // Reconcile even after cancellation: publication may already have completed.
      if (!disposed) {
        try { await options.changed(); } catch { status = { code: 'flowsNetworkError' }; }
      }
      busy = undefined; controller = undefined; notify();
    }
  }
  return {
    get busy() { return busy; }, get status() { return status; }, get diagnostics() { return diagnostics; },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    toggle(source: FlowSource, revision?: string) { return run('activation', project => project.setBundleEnabled(source.id, !source.enabled, revision)); },
    install(value: string, method: 'file' | 'url', scope: 'global' | 'project') {
      return run('install', (project, signal) => method === 'url' ? project.installBundle(value, scope, signal) : project.installBundleFile(bundlePath(value), scope, signal));
    },
    cancel() { if (busy === 'install') controller?.abort(); },
    dispose() { disposed = true; controller?.abort(); listeners.clear(); },
  };
}
export type FlowSources = ReturnType<typeof createFlowSources>;
export function sourceDiagnostics(source: FlowSource, snapshot: FlowSnapshot): FlowDiagnostic[] {
  return [...source.diagnostics, ...snapshot.diagnostics.filter(item => item.code === 'flowsSourceConflict' && source.enabled && source.blueprintIds.includes(String(item.params.id)) && String(item.params.sources).split(', ').some(origin => origin === source.id || origin.startsWith(source.id + '/')))];
}
export function bundlePath(value: string) { return resolve(value === '~' ? homedir() : value.startsWith('~/') ? join(homedir(), value.slice(2)) : value); }
export interface BundleFileEntry { name: string; path: string; directory: boolean }
export async function browseBundleFiles(value: string): Promise<{ directory: string; entries: BundleFileEntry[] }> {
  const path = bundlePath(value || '.');
  const isDirectory = await stat(path).then(s => s.isDirectory()).catch(() => false);
  const directory = isDirectory ? path : dirname(path), prefix = isDirectory ? '' : basename(path).toLocaleLowerCase();
  const entries = (await readdir(directory, { withFileTypes: true }))
    .filter(entry => (entry.isDirectory() || (entry.isFile() && /\.blueprint$/i.test(entry.name))) && entry.name.toLocaleLowerCase().startsWith(prefix))
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    .map(entry => ({ name: entry.name + (entry.isDirectory() ? '/' : ''), path: join(directory, entry.name), directory: entry.isDirectory() }));
  if (dirname(directory) !== directory) entries.unshift({ name: '..', path: dirname(directory), directory: true });
  return { directory, entries };
}

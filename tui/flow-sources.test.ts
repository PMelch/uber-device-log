import { test, expect } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FlowProject } from '../server/flow-project';
import { fixtureBundle } from '../server/fixtures/flow-bundle';
async function module() { const m = await import('./flow-sources').catch(() => ({})) as any; expect(typeof m.createFlowSources).toBe('function'); return m; }

test('source manager installs disabled bundles, persists activation and reports stale revisions', async () => {
  const { createFlowSources } = await module();
  const home = await mkdtemp(join(tmpdir(), 'udl-sources-'));
  try {
    const registry = await FlowProject.create(undefined, { home }); let snapshot = await registry.reload();
    const manager = createFlowSources({ project: async () => registry, changed: async () => { snapshot = await registry.reload(); } });
    const file = join(home, 'sample.blueprint'); await writeFile(file, fixtureBundle());
    await manager.install(file, 'file', 'global');
    expect(manager.status.code).toBe('flowsBundleInstalled');
    const source = snapshot.sources!.find(s => s.kind === 'bundle')!;
    expect(source.enabled).toBe(false);
    const revision = snapshot.configRevision;
    await manager.toggle(source, revision); expect(manager.status.code).toBe('flowsBundleSaved');
    expect(snapshot.sources!.find(s => s.id === source.id)!.enabled).toBe(true);
    await manager.toggle(source, revision); expect(manager.status.code).toBe('flowsConflict');
    await manager.install(file, 'file', 'project'); expect(manager.diagnostics.length).toBeGreaterThan(0);
    manager.dispose();
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('cancellation reaches the download, blocks duplicate mutations and ignores disposed results', async () => {
  const { createFlowSources } = await module(); let signal: AbortSignal | undefined, calls = 0, refreshed = 0;
  const manager = createFlowSources({ project: async () => ({ installBundle(_url: string, _scope: string, next: AbortSignal) { calls++; signal = next; return new Promise((_, reject) => next.addEventListener('abort', () => reject(next.reason))); } }), changed: async () => { refreshed++; } });
  const first = manager.install('https://example.test/test.blueprint', 'url', 'global'); await Bun.sleep(5);
  await manager.install('duplicate', 'url', 'global'); expect(calls).toBe(1);
  manager.cancel(); await first; expect(signal!.aborted).toBe(true); expect(manager.status.code).toBe('flowsBundleCancelled');
  expect(refreshed).toBe(1); manager.dispose();
});

test('global and project source activation persists independently after reopening the TUI', async () => {
  const { createFlowSources } = await module();
  const home = await mkdtemp(join(tmpdir(), 'udl-source-activation-'));
  const directory = join(home, 'project');
  await mkdir(directory);
  let manager: ReturnType<typeof createFlowSources> | undefined;
  try {
    let registry = await FlowProject.create(directory, { home });
    let snapshot = await registry.reload();
    const openManager = () => createFlowSources({ project: async () => registry, changed: async () => { snapshot = await registry.reload(); } });
    manager = openManager();
    for (const scope of ['global', 'project'] as const) {
      const file = join(home, `${scope}.blueprint`);
      await writeFile(file, fixtureBundle(scope, `${scope}-flow`));
      await manager.install(file, 'file', scope);
      const source = snapshot.sources!.find(source => source.kind === 'bundle' && source.scope === scope)!;
      await manager.toggle(source, snapshot.configRevision);
      expect(manager.status.code).toBe('flowsBundleSaved');
    }
    manager.dispose();
    registry = await FlowProject.create(directory, { home });
    snapshot = await registry.reload();
    manager = openManager();
    expect(snapshot.blueprints.map(blueprint => blueprint.id).sort()).toEqual(['global-flow', 'project-flow']);
    const global = snapshot.sources!.find(source => source.kind === 'bundle' && source.scope === 'global')!;
    await manager.toggle(global, snapshot.configRevision);
    expect(manager.status.code).toBe('flowsBundleSaved');
    expect(snapshot.blueprints.map(blueprint => blueprint.id)).toEqual(['project-flow']);
    registry = await FlowProject.create(directory, { home });
    snapshot = await registry.reload();
    expect(snapshot.sources!.find(source => source.id === global.id)!.enabled).toBe(false);
    expect(snapshot.sources!.find(source => source.kind === 'bundle' && source.scope === 'project')!.enabled).toBe(true);
    expect(snapshot.blueprints.map(blueprint => blueprint.id)).toEqual(['project-flow']);
  } finally { manager?.dispose(); await rm(home, { recursive: true, force: true }); }
});

test('file chooser filters bundle files, supports directory navigation and path completion', async () => {
  const { browseBundleFiles } = await module(); const home = await mkdtemp(join(tmpdir(), 'udl-picker-'));
  try {
    await mkdir(join(home, 'nested')); await writeFile(join(home, 'test.blueprint'), 'x'); await writeFile(join(home, 'other.txt'), 'x');
    const result = await browseBundleFiles(home);
    expect(result.entries.map((x: any) => x.name)).toEqual(['..', 'nested/', 'test.blueprint']);
    expect((await browseBundleFiles(join(home, 'te'))).entries.map((x: any) => x.name)).toEqual(['..', 'test.blueprint']);
  } finally { await rm(home, { recursive: true, force: true }); }
});

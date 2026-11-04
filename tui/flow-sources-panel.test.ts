import { test, expect } from 'bun:test';
import { createTestRenderer } from '@opentui/core/testing';
import { createTuiTheme } from './theme';
import { createFlowSources } from './flow-sources';
import type { FlowSnapshot, FlowSource } from '../shared/flow-types';
import type { TuiFlows } from './flows-model';
const source: FlowSource = { id: 'global:checkout', name: 'Checkout', kind: 'bundle', scope: 'global', filename: 'checkout.blueprint', revision: '1', enabled: true, blueprintIds: ['checkout'], activeBlueprintIds: ['checkout'], diagnostics: [] };
function fixture() {
  const snapshot: FlowSnapshot = { enabled: true, context: 'project', configRevision: 'v1', revision: 'v1', projectName: 'Shop', directory: '.', files: [], blueprints: [], diagnostics: [], sources: [source, { ...source, id: 'project:loose', name: 'Local YAML', scope: 'project', kind: 'loose' }] };
  const listeners = new Set<() => void>(); let toggled = '';
  const manager = createFlowSources({ project: async () => ({ async setBundleEnabled(id: string) { toggled = id; }, async installBundle() {}, async installBundleFile() {} }) as any, changed: async () => { for (const fn of listeners) fn(); } });
  const flows = { snapshot, state: { instances: [], gaps: 0 }, loading: false, reload: async () => {}, sources: manager, subscribe(fn: () => void) { listeners.add(fn); return () => listeners.delete(fn); } } as unknown as TuiFlows;
  return { flows, manager, get toggled() { return toggled; }, notify() { for (const fn of listeners) fn(); } };
}
async function module() { const m = await import('./flow-sources-panel').catch(() => ({})) as any; expect(typeof m.createFlowSourcesPanel).toBe('function'); return m; }
test('sources panel supports search, activation, focus containment and narrow detail navigation', async () => {
  const { createFlowSourcesPanel } = await module(); const terminal = await createTestRenderer({ width: 100, height: 28 }); const f = fixture(); let closed = false;
  const panel = createFlowSourcesPanel(terminal.renderer, { flows: f.flows, locale: () => 'en', colors: () => createTuiTheme('dark'), close() { closed = true; } });
  try {
    await terminal.renderOnce(); expect(terminal.captureCharFrame()).toContain('Checkout');
    terminal.renderer.root.findDescendantById('source-toggle')!.focus(); terminal.mockInput.pressEnter(); await Bun.sleep(60); expect(f.toggled).toBe(source.id);
    terminal.resize(60, 24); await terminal.renderOnce();
    terminal.renderer.root.findDescendantById('source-row-0')!.focus(); terminal.mockInput.pressEnter(); await terminal.renderOnce();
    expect(terminal.renderer.root.findDescendantById('source-details')!.visible).toBe(true);
    terminal.mockInput.pressEscape(); await Bun.sleep(60); expect(closed).toBe(false);
    terminal.renderer.root.findDescendantById('sources-search')!.focus(); await terminal.mockInput.typeText('Local'); await terminal.renderOnce();
    expect(terminal.captureCharFrame()).not.toContain('Checkout'); expect(terminal.captureCharFrame()).toContain('Local YAML');
    terminal.mockInput.pressEscape(); await Bun.sleep(60); expect(closed).toBe(true);
  } finally { panel.dispose(); f.manager.dispose(); await terminal.dispose(); }
});
test('installation and diagnostics remain accessible at small widths in every locale', async () => {
  const { createFlowSourcesPanel } = await module();
  for (const locale of ['en', 'de', 'es', 'fr', 'it', 'ja', 'zh-CN'] as const) {
    const terminal = await createTestRenderer({ width: 60, height: 24 }); const f = fixture();
    const panel = createFlowSourcesPanel(terminal.renderer, { flows: f.flows, locale: () => locale, colors: () => createTuiTheme('light'), close() {} });
    try {
      await terminal.renderOnce(); terminal.renderer.root.findDescendantById('sources-install')!.focus(); terminal.mockInput.pressEnter(); await terminal.renderOnce();
      const input = terminal.renderer.root.findDescendantById('bundle-location')!; expect(input.visible).toBe(true); expect(input.y).toBeLessThan(24);
      const submit = terminal.renderer.root.findDescendantById('bundle-submit')!; expect(submit.y + submit.height).toBeLessThanOrEqual(22);
      terminal.mockInput.pressEscape(); await Bun.sleep(60); await terminal.renderOnce();
      expect(terminal.renderer.currentFocusedRenderable!.id).toBe('sources-install');
    } finally { panel.dispose(); f.manager.dispose(); await terminal.dispose(); }
  }
});

test('mouse selection, file browsing and Tab stay inside the source manager', async () => {
  const { createFlowSourcesPanel } = await import('./flow-sources-panel');
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises'); const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const directory = await mkdtemp(join(tmpdir(), 'udl-source-ui-'));
  const terminal = await createTestRenderer({ width: 100, height: 30 }); const f = fixture();
  const panel = createFlowSourcesPanel(terminal.renderer, { flows: f.flows, locale: () => 'en', colors: () => createTuiTheme('dark'), close() {} });
  try {
    await mkdir(join(directory, 'child')); await writeFile(join(directory, 'one.blueprint'), 'fixture');
    await terminal.renderOnce(); const row = terminal.renderer.root.findDescendantById('source-row-1')!;
    await terminal.mockMouse.click(row.x + 2, row.y + 1); await terminal.renderOnce(); expect(terminal.captureCharFrame()).toContain('Loaded automatically');
    terminal.renderer.root.findDescendantById('sources-install')!.focus(); terminal.mockInput.pressEnter(); await terminal.renderOnce();
    const input = terminal.renderer.root.findDescendantById('bundle-location') as import('@opentui/core').InputRenderable; input.value = directory;
    terminal.renderer.root.findDescendantById('bundle-choose')!.focus(); terminal.mockInput.pressEnter(); await Bun.sleep(40); await terminal.renderOnce();
    expect(terminal.captureCharFrame()).toContain('one.blueprint');
    for (let i = 0; i < 12; i++) { terminal.mockInput.pressTab(); expect(terminal.renderer.currentFocusedRenderable?.isDestroyed).not.toBe(true); }
    const file = terminal.renderer.root.findDescendantById('bundle-file-2')!; file.focus(); terminal.mockInput.pressEnter(); await terminal.renderOnce();
    expect(input.value).toBe(join(directory, 'one.blueprint')); expect(terminal.renderer.currentFocusedRenderable?.id).toBe('bundle-location');
  } finally { panel.dispose(); f.manager.dispose(); await terminal.dispose(); await rm(directory, { recursive: true, force: true }); }
});

test('live source updates preserve focus and render conflicts and unsafe text safely', async () => {
  const { createFlowSourcesPanel } = await import('./flow-sources-panel'); const terminal = await createTestRenderer({ width: 120, height: 32 }); const f = fixture();
  const panel = createFlowSourcesPanel(terminal.renderer, { flows: f.flows, locale: () => 'en', colors: () => createTuiTheme('dark'), close() {} });
  try {
    await terminal.renderOnce(); const row = terminal.renderer.root.findDescendantById('source-row-0')!; row.focus();
    f.flows.snapshot!.sources![0] = { ...source, description: 'bad\x1b[2Jtext', activeBlueprintIds: [] };
    f.flows.snapshot!.diagnostics = [{ code: 'flowsSourceConflict', params: { id: 'checkout', sources: 'global:checkout/a.yaml, project:other/b.yaml' }, message: 'conflict' }]; f.notify(); await terminal.renderOnce();
    expect(terminal.renderer.currentFocusedRenderable).toBe(row); expect(terminal.captureCharFrame()).toContain('bad\\u001b[2Jtext'); expect(terminal.captureCharFrame()).toContain('All conflicting');
    f.flows.snapshot!.sources = []; f.notify(); await terminal.renderOnce(); expect(terminal.renderer.currentFocusedRenderable?.id).toBe('sources-search');
  } finally { panel.dispose(); f.manager.dispose(); await terminal.dispose(); }
});

test('Flows entry opens sources and restores the trigger focus without closing Flows', async () => {
  const { createFlowsPanel } = await import('./flows-panel'); const terminal = await createTestRenderer({ width: 100, height: 28 }); const f = fixture(); let closed = false;
  const panel = createFlowsPanel(terminal.renderer, { flows: f.flows, locale: () => 'en', colors: () => createTuiTheme('dark'), close() { closed = true; } });
  try {
    await terminal.renderOnce(); terminal.renderer.root.findDescendantById('flows-sources')!.focus(); terminal.mockInput.pressEnter(); await terminal.renderOnce();
    expect(terminal.renderer.root.findDescendantById('flows-panel')!.visible).toBe(false);
    expect(terminal.captureCharFrame()).toContain('Blueprint sources');
    terminal.mockInput.pressEscape(); await Bun.sleep(60); await terminal.renderOnce();
    expect(closed).toBe(false); expect(terminal.renderer.root.findDescendantById('flows-panel')!.visible).toBe(true);
    expect(terminal.renderer.currentFocusedRenderable?.id).toBe('flows-sources');
  } finally { panel.dispose(); f.manager.dispose(); await terminal.dispose(); }
});

test('narrow source detail returns to visible search when external edits remove the last match', async () => {
  const { createFlowSourcesPanel } = await import('./flow-sources-panel'); const terminal = await createTestRenderer({ width: 60, height: 24 }); const f = fixture();
  const panel = createFlowSourcesPanel(terminal.renderer, { flows: f.flows, locale: () => 'en', colors: () => createTuiTheme('dark'), close() {} });
  try {
    await terminal.renderOnce(); terminal.renderer.root.findDescendantById('source-row-0')!.focus(); terminal.mockInput.pressEnter(); await terminal.renderOnce();
    f.flows.snapshot!.sources = []; f.notify(); await terminal.renderOnce();
    expect(terminal.captureCharFrame()).toContain('No Blueprint sources available.');
    expect(terminal.renderer.currentFocusedRenderable?.id).toBe('sources-search');
    let node = terminal.renderer.currentFocusedRenderable; while (node) { expect(node.visible).toBe(true); node = node.parent!; }
  } finally { panel.dispose(); f.manager.dispose(); await terminal.dispose(); }
});

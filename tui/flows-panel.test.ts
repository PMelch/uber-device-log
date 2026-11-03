import { test, expect } from 'bun:test';
import { createTestRenderer } from '@opentui/core/testing';
import { createFlowEngine } from '../shared/flow-engine';
import { createTuiTheme } from './theme';
import type { TuiFlows } from './flows-model';
import type { FlowBlueprint } from '../shared/flow-types';

const definition: FlowBlueprint = { version: 1, id: 'checkout', name: 'Checkout', start: 'request', timeout: '10s', correlation: { scope: 'device-session', primary: 'id' }, steps: [
  { id: 'request', name: 'Request', match: { contains: 'start' }, extract: { id: { json: 'id' }, secret: { json: 'secret', sensitive: true, result: true } }, next: ['done'] },
  { id: 'done', name: 'Confirmed', match: { contains: 'done' }, extract: { id: { json: 'id' } }, outcome: 'completed' },
] };
function fixture() {
  const engine = createFlowEngine(() => performance.timeOrigin + performance.now()); engine.setBlueprints([definition], 'v1');
  const listeners = new Set<() => void>();
  const ingest = (event: string) => { engine.ingest([{ timestamp: '2026-11-03T12:00:00Z', message: JSON.stringify({ event, id: 'a', secret: 'hidden-token' }) }]); for (const fn of listeners) fn(); };
  const flows = { get state() { return engine.getState(); }, snapshot: { enabled: true, blueprints: [definition], diagnostics: [], projectName: 'Fixture' }, loading: false,
    subscribe(fn: () => void) { listeners.add(fn); return () => listeners.delete(fn); }, reload() {}, clear() { engine.clear(); for (const fn of listeners) fn(); }, restart() {} } as unknown as TuiFlows;
  return { flows, ingest };
}
test('flow screen opens an event timeline, masks sensitive payloads and keeps selection during updates', async () => {
  const { createFlowsPanel } = await import('./flows-panel').catch(() => ({})) as any;
  expect(typeof createFlowsPanel).toBe('function');
  const terminal = await createTestRenderer({ width: 100, height: 30 }); const f = fixture(); f.ingest('start');
  let closed = false;
  const panel = createFlowsPanel(terminal.renderer, { flows: f.flows, locale: () => 'en', colors: () => createTuiTheme('dark'), close: () => { closed = true; } });
  try {
    await terminal.renderOnce(); expect(terminal.captureCharFrame()).toContain('Checkout');
    terminal.renderer.root.findDescendantById('flow-list')!.focus(); terminal.mockInput.pressEnter(); await terminal.renderOnce();
    expect(terminal.captureCharFrame()).toContain('Timeline');
    expect(terminal.captureCharFrame()).not.toContain('hidden-token');
    f.ingest('done'); await terminal.renderOnce(); expect(terminal.captureCharFrame()).toContain('Completed');
    terminal.renderer.root.findDescendantById('flow-reveal')!.focus(); terminal.mockInput.pressEnter(); await terminal.renderOnce();
    expect(terminal.captureCharFrame()).toContain('hidden-token');
    terminal.mockInput.pressEscape(); await Bun.sleep(50); await terminal.renderOnce();
    expect(closed).toBe(false);
    terminal.mockInput.pressEscape(); await Bun.sleep(50); expect(closed).toBe(true);
  } finally { panel.dispose(); await terminal.dispose(); }
});

test('flow detail remains usable at narrow and wide widths in all locales', async () => {
  const { createFlowsPanel } = await import('./flows-panel');
  for (const locale of ['en', 'de', 'es', 'fr', 'it', 'ja', 'zh-CN'] as const) {
    const terminal = await createTestRenderer({ width: 120, height: 32 }); const f = fixture(); f.ingest('start');
    const panel = createFlowsPanel(terminal.renderer, { flows: f.flows, locale: () => locale, colors: () => createTuiTheme('light'), close() {} });
    try {
      await terminal.renderOnce();
      terminal.renderer.root.findDescendantById('flow-list')!.focus(); terminal.mockInput.pressEnter();
      for (const width of [120, 60]) {
        terminal.resize(width, 24); await terminal.renderOnce();
        const inspector = terminal.renderer.root.findDescendantById('flow-inspector')!;
        expect(inspector.height).toBeGreaterThanOrEqual(4);
        expect(inspector.y + inspector.height).toBeLessThanOrEqual(22);
        expect(inspector.x + inspector.width).toBeLessThanOrEqual(width);
      }
    } finally { panel.dispose(); await terminal.dispose(); }
  }
});

test('flow search and virtual rows remain bounded with large lists and preserve the navigated item', async () => {
  const { createFlowsPanel } = await import('./flows-panel');
  const terminal = await createTestRenderer({ width: 100, height: 28 }); const f = fixture(); f.ingest('start');
  const base = f.flows.state.instances[0]!;
  let instances = Array.from({ length: 1000 }, (_, i) => ({ ...base, id: `run-${i}`, blueprint: { ...base.blueprint, name: `Checkout ${i}` } }));
  let update = () => {};
  const flows = { ...f.flows, get state() { return { instances, gaps: 0 }; }, subscribe(fn: () => void) { update = fn; return () => {}; } } as TuiFlows;
  const panel = createFlowsPanel(terminal.renderer, { flows, locale: () => 'en', colors: () => createTuiTheme('dark'), close() {} });
  try {
    await terminal.renderOnce();
    expect(!!terminal.renderer.root.findDescendantById('flow-row-20')).toBe(false);
    terminal.renderer.root.findDescendantById('flow-list')!.focus(); terminal.mockInput.pressArrow('down');
    instances = [...instances, { ...base, id: 'new', blueprint: { ...base.blueprint, name: 'New arrival' } }]; update();
    terminal.mockInput.pressEnter(); await terminal.renderOnce();
    expect(terminal.captureCharFrame()).toContain('Checkout 998');
    terminal.mockInput.pressEscape(); await Bun.sleep(50);
    const search = terminal.renderer.root.findDescendantById('flows-search')!; search.focus();
    await terminal.mockInput.typeText('Checkout 42'); await terminal.renderOnce();
    expect(terminal.captureCharFrame()).toContain('Checkout 42');
    expect(terminal.captureCharFrame()).not.toContain('New arrival');
  } finally { panel.dispose(); await terminal.dispose(); }
});

test('empty and failed analysis states expose diagnostics and a working restart control', async () => {
  const { createFlowsPanel } = await import('./flows-panel');
  const terminal = await createTestRenderer({ width: 80, height: 24 }); const f = fixture();
  let restarted = false;
  const flows = { ...f.flows, error: { code: 'flowsWorkerError' }, snapshot: { ...f.flows.snapshot!, blueprints: [], diagnostics: [{ code: 'flowsDiagnostic', params: { detail: 'invalid blueprint' }, message: 'invalid blueprint' }] }, restart() { restarted = true; } } as TuiFlows;
  const panel = createFlowsPanel(terminal.renderer, { flows, locale: () => 'en', colors: () => createTuiTheme('mono'), close() {} });
  try {
    await terminal.renderOnce(); expect(terminal.captureCharFrame()).toContain('No blueprints loaded.');
    expect(terminal.captureCharFrame()).toContain('invalid blueprint');
    terminal.renderer.root.findDescendantById('flows-info')!.focus(); terminal.mockInput.pressEnter(); await terminal.renderOnce();
    expect(terminal.captureCharFrame()).toContain('invalid blueprint');
    terminal.renderer.root.findDescendantById('flows-restart')!.focus(); terminal.mockInput.pressEnter(); expect(restarted).toBe(true);
  } finally { panel.dispose(); await terminal.dispose(); }
});

test('concurrent same-label flows expose stable IDs and can be found by ID', async () => {
  const { createFlowsPanel } = await import('./flows-panel');
  const terminal = await createTestRenderer({ width: 100, height: 28 }); const f = fixture(); f.ingest('start');
  const base = f.flows.state.instances[0]!;
  const flows = { ...f.flows, state: { instances: [{ ...base, id: 'checkout-17' }, { ...base, id: 'checkout-18' }], gaps: 0 } } as TuiFlows;
  const panel = createFlowsPanel(terminal.renderer, { flows, locale: () => 'en', colors: () => createTuiTheme('dark'), close() {} });
  try {
    await terminal.renderOnce(); expect(terminal.captureCharFrame()).toContain('checkout-17'); expect(terminal.captureCharFrame()).toContain('checkout-18');
    terminal.renderer.root.findDescendantById('flows-search')!.focus(); await terminal.mockInput.typeText('checkout-17'); await terminal.renderOnce();
    expect(terminal.captureCharFrame()).not.toContain('checkout-18');
    terminal.renderer.root.findDescendantById('flow-list')!.focus(); terminal.mockInput.pressEnter(); await terminal.renderOnce();
    expect(terminal.captureCharFrame()).toContain('checkout-17');
  } finally { panel.dispose(); await terminal.dispose(); }
});

test('flow diagnostic status escapes terminal controls from blueprint errors', async () => {
  const { createFlowsPanel } = await import('./flows-panel');
  const terminal = await createTestRenderer({ width: 100, height: 24 }); const f = fixture();
  const flows = { ...f.flows, snapshot: { ...f.flows.snapshot!, diagnostics: [{ code: 'flowsDiagnostic', params: { detail: 'bad\x1b[2Jfile' }, message: 'bad file' }] } } as TuiFlows;
  const panel = createFlowsPanel(terminal.renderer, { flows, locale: () => 'en', colors: () => createTuiTheme('dark'), close() {} });
  try {
    await terminal.renderOnce();
    expect(terminal.captureCharFrame()).toContain('bad\\u001b[2Jfile');
    expect(terminal.captureCharFrame()).not.toContain('\x1b');
  } finally { panel.dispose(); await terminal.dispose(); }
});

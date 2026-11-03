import { test, expect } from 'bun:test';
import type { TextRenderable } from '@opentui/core';
import { createTestRenderer } from '@opentui/core/testing';
import { createTui, type TuiOptions } from './app';

async function setup(options: TuiOptions = {}) {
  const terminal = await createTestRenderer({ width: 100, height: 30 });
  const app = createTui(terminal.renderer, { locale: 'en', detectTerminalTheme: false, sourceRefreshMs: 0, ...options });
  app.ingest(Array.from({ length: 100 }, (_, i) => ({ timestamp: '2026-11-03T12:00:00Z', level: 'INFO', message: `record-${i}` })));
  await terminal.renderOnce();
  return { ...terminal, app };
}

test('Tab advances focus and a mouse click shares the same focus chain', async () => {
  const t = await setup();
  try {
    expect(t.renderer.currentFocusedRenderable?.id).toBe('sources');
    t.mockInput.pressTab();
    expect(t.renderer.currentFocusedRenderable?.id).toBe('pause');
    const search = t.app.controls.search;
    await t.mockMouse.click(search.x + 2, search.y);
    expect(t.renderer.currentFocusedRenderable?.id).toBe('search');
    t.mockInput.pressTab();
    expect(t.renderer.currentFocusedRenderable?.id).toBe('logs');
    t.mockInput.pressTab({ shift: true });
    expect(t.renderer.currentFocusedRenderable?.id).toBe('search');
  } finally { t.app.dispose(); await t.dispose(); }
});

test('mouse selects a log, freezes capture view and exposes full details', async () => {
  const t = await setup();
  try {
    const line = t.app.controls.rows[0];
    await t.mockMouse.click(line.x + 2, line.y);
    expect(t.app.model.paused).toBe(true);
    const selected = t.app.model.selected;
    expect(selected).toBeDefined();
    t.app.ingest([{ timestamp: '2026-11-03T12:00:01Z', message: 'new arrival' }]);
    expect(t.app.model.selected.key).toBe(selected.key);
    expect(t.app.model.rows()).not.toContainEqual(expect.objectContaining({ message: 'new arrival' }));
    await t.renderOnce();
    expect(t.captureCharFrame()).toContain(selected.message);
    const pause = t.app.controls.pause;
    await t.mockMouse.click(pause.x + 1, pause.y + 1);
    expect(t.app.model.paused).toBe(false);
    expect(t.app.model.rows().at(-1).message).toBe('new arrival');
  } finally { t.app.dispose(); await t.dispose(); }
});

test('typing shortcut letters searches instead of triggering actions; wheel and resize keep bounded renderables', async () => {
  const t = await setup();
  try {
    t.app.controls.search.focus();
    await t.mockInput.typeText('pause');
    expect(t.app.model.paused).toBe(false);
    expect(t.app.model.query).toBe('pause');
    t.app.controls.search.value = '';
    t.app.setQuery('');
    const logs = t.app.controls.logs;
    await t.mockMouse.scroll(logs.x + 2, logs.y + 2, 'up');
    expect(t.app.model.paused).toBe(true);
    t.resize(60, 20);
    await t.renderOnce();
    expect(t.app.controls.rows.length).toBeLessThan(40);
    expect(t.captureCharFrame()).toContain('Über Device Log');
  } finally { t.app.dispose(); await t.dispose(); }
});


test('source dialog contains Tab focus, supports mouse choice and restores focus', async () => {
  let chosen = '';
  const t = await setup({ sources: async () => [{ id: 'phone', name: 'Phone', platform: 'android', state: 'connected' }], chooseSource: device => { chosen = device.id; } });
  try {
    const source = t.app.controls.sources;
    await t.mockMouse.click(source.x + 1, source.y + 1);
    await t.renderOnce();
    expect(t.renderer.currentFocusedRenderable?.id).toBe('close-sources');
    t.mockInput.pressTab();
    expect(t.renderer.currentFocusedRenderable?.id).toBe('source-0');
    t.mockInput.pressTab();
    expect(t.renderer.currentFocusedRenderable?.id).toBe('close-sources');
    const item = t.renderer.root.findDescendantById('source-0') as typeof source;
    await t.mockMouse.click(item.x + 1, item.y + 1);
    expect(chosen).toBe('phone');
    expect(t.renderer.currentFocusedRenderable?.id).toBe('sources');
  } finally { t.app.dispose(); await t.dispose(); }
});

test('detail text supports drag selection and remains selected during background arrivals', async () => {
  const t = await setup();
  try {
    const row = t.app.controls.rows[0]!;
    await t.mockMouse.click(row.x + 1, row.y);
    await t.renderOnce();
    const detail = t.app.controls.details;
    await t.mockMouse.drag(detail.x + 3, detail.y + 2, detail.x + 18, detail.y + 2);
    const selected = t.renderer.getSelection()?.getSelectedText();
    expect(selected?.length).toBeGreaterThan(0);
    t.app.ingest([{ timestamp: '2026-11-03T12:00:01Z', message: 'new arrival' }]);
    await t.renderOnce();
    expect(t.renderer.getSelection()?.getSelectedText()).toBe(selected);
  } finally { t.app.dispose(); await t.dispose(); }
});

test('log scrollbar can be dragged without allocating one element per log', async () => {
  const t = await setup({ capacity: 100000 });
  try {
    t.app.ingest(Array.from({ length: 100000 }, (_, i) => ({ timestamp: '2026-11-03T12:00:01Z', message: `large-${i}` })));
    await t.renderOnce();
    const bar = t.app.controls.scrollbar;
    expect(bar).toBeDefined();
    await t.mockMouse.drag(bar.x, bar.y + bar.height - 2, bar.x, bar.y + 1);
    expect(t.app.model.paused).toBe(true);
    expect(t.app.controls.rows.length).toBeLessThan(40);
  } finally { t.app.dispose(); await t.dispose(); }
});

test('detail text preserves literal backslash-n and real line breaks separately', async () => {
  const t = await setup();
  try {
    t.app.model.clear();
    t.app.ingest([{ timestamp: '2026-11-03T12:00:01Z', message: 'literal \\n\nactual line' }]);
    await t.renderOnce();
    const row = t.app.controls.rows[0]!;
    await t.mockMouse.click(row.x + 1, row.y);
    await t.renderOnce();
    const text = t.renderer.root.findDescendantById('detail-text') as TextRenderable;
    expect(text.plainText).toContain('literal \\n\nactual line');
  } finally { t.app.dispose(); await t.dispose(); }
});

test('local source controls combine sources from one device', async () => {
  const selected: string[][] = [];
  const device = { id: 'p', name: 'Pixel', platform: 'android' as const, state: 'connected' };
  const webview = { ...device, webview: { id: 'w', socket: 's', title: 'Shop', url: 'https://shop.test' } };
  const t = await setup({ demo: false, sources: async () => [device, webview], syncSources: devices => selected.push(devices.map(d => d.webview?.id || d.id)) });
  try {
    await t.app.refreshSources(); await t.renderOnce();
    t.app.toggleSource(device); t.app.toggleSource(webview);
    expect(selected.at(-1)).toEqual(['p', 'w']);
    t.app.toggleSource(device);
    expect(selected.at(-1)).toEqual(['w']);
  } finally { t.app.dispose(); await t.dispose(); }
});

test('Tab scrolls overflowing source controls into view on a narrow terminal', async () => {
  const devices = Array.from({ length: 8 }, (_, i) => ({ id: String(i), name: `Phone ${i}`, platform: 'android' as const, state: 'connected' }));
  const t = await setup({ demo: false, sources: async () => devices, syncSources() {} });
  try {
    t.resize(70, 30); await t.app.refreshSources(); await t.renderOnce();
    for (let i = 0; i < 30 && t.renderer.currentFocusedRenderable?.id !== 'sidebar-source-7'; i++) {
      t.mockInput.pressTab(); await t.renderOnce();
    }
    const focused = t.renderer.currentFocusedRenderable!;
    expect(focused.id).toBe('sidebar-source-7');
    expect(focused.y).toBeGreaterThan(6);
    expect(focused.y + focused.height).toBeLessThan(20);
    expect(t.captureCharFrame()).toContain('Phone 7');
  } finally { t.app.dispose(); await t.dispose(); }
});

test('details restore on widening and hidden details are skipped by Tab', async () => {
  const t = await setup({ syncSources() {} });
  try {
    t.resize(70, 30); await t.renderOnce();
    expect(t.app.controls.details.visible).toBe(false);
    t.app.controls.logs.focus(); t.mockInput.pressTab();
    expect(t.renderer.currentFocusedRenderable?.id).not.toBe('details');
    t.resize(120, 30); await t.renderOnce();
    expect(t.app.controls.details.visible).toBe(true);
  } finally { t.app.dispose(); await t.dispose(); }
});

test('local layout keeps logs usable across languages and terminal widths', async () => {
  for (const locale of ['en', 'de', 'es', 'fr', 'it', 'ja', 'zh-CN'] as const) {
    const t = await setup({ locale, syncSources() {} });
    try {
      for (const width of [70, 120]) {
        t.resize(width, 30); await t.renderOnce();
        expect(t.app.controls.logs.height).toBeGreaterThan(3);
        expect(t.app.controls.logs.y + t.app.controls.logs.height).toBeLessThanOrEqual(27);
      }
    } finally { t.app.dispose(); await t.dispose(); }
  }
});

test('sources collapse and log fullscreen preserve capture, selection and restore layout', async () => {
  const t = await setup({ demo: false, syncSources() {} });
  try {
    t.app.model.select(t.app.model.rows()[0]!.key);
    const selected = t.app.model.selected;
    t.app.toggleSources(); await t.renderOnce();
    expect(t.app.controls.sidebar.visible).toBe(false);
    t.app.toggleFullscreen(); await t.renderOnce();
    expect(t.app.controls.logs.width).toBeGreaterThan(95);
    expect(t.app.controls.details.visible).toBe(false);
    t.app.ingest([{ timestamp: 'now', message: 'incoming' }]);
    expect(t.app.model.selected).toBe(selected);
    t.app.toggleFullscreen(); await t.renderOnce();
    expect(t.app.controls.sidebar.visible).toBe(false);
    expect(t.app.controls.details.visible).toBe(true);
    t.app.toggleSources(); await t.renderOnce();
    expect(t.app.controls.sidebar.visible).toBe(true);
  } finally { t.app.dispose(); await t.dispose(); }
});

test('fullscreen mouse button restores layout and Tab skips hidden toolbar and sources', async () => {
  const t = await setup({ demo: false, syncSources() {} });
  try {
    const control = t.app.controls.maximize;
    await t.mockMouse.click(control.x + 1, control.y + 1); await t.renderOnce();
    t.app.controls.logs.focus(); t.mockInput.pressTab();
    expect(t.renderer.currentFocusedRenderable?.id).toBe('exit-fullscreen');
    t.mockInput.pressEnter(); await t.renderOnce();
    expect(t.app.controls.sidebar.visible).toBe(true);
    expect(t.app.controls.details.visible).toBe(true);
  } finally { t.app.dispose(); await t.dispose(); }
});

test('frame controls collapse and reopen sources and toggle log fullscreen', async () => {
  const t = await setup({ demo: false, syncSources() {} });
  try {
    const sidebar = t.app.controls.sidebar;
    await t.mockMouse.click(sidebar.x + 4, sidebar.y); await t.renderOnce();
    expect(sidebar.visible).toBe(false);
    const collapsed = t.app.controls.collapsedSources;
    expect(collapsed.visible).toBe(true);
    await t.mockMouse.click(collapsed.x + 4, collapsed.y); await t.renderOnce();
    expect(sidebar.visible).toBe(true);
    const logs = t.app.controls.logs;
    await t.mockMouse.click(logs.x + 2, logs.y); await t.renderOnce();
    expect(logs.width).toBeGreaterThan(95);
    expect(t.app.controls.details.visible).toBe(false);
    expect(t.app.model.paused).toBe(false);
    await t.mockMouse.click(logs.x + 2, logs.y); await t.renderOnce();
    expect(sidebar.visible).toBe(true);
    expect(t.app.controls.details.visible).toBe(true);
  } finally { t.app.dispose(); await t.dispose(); }
});

test('appearance changes recolor log parts without changing records or frozen selection', async () => {
  const t = await setup();
  try {
    t.app.ingest([{ timestamp: '2026-11-03T12:00:02Z', level: 'ERROR', tag: 'Checkout', message: 'Failure' }]);
    t.app.model.select(t.app.model.rows().at(-1)!.key);
    const selected = t.app.model.selected;
    t.app.setTheme('light'); await t.renderOnce();
    expect(t.app.theme.background).toBe('#ffffff');
    expect(t.app.model.selected).toBe(selected);
    const row = t.app.controls.rows.find(r => r.chunks.some(c => c.text === 'Failure'))!;
    expect(row.chunks.length).toBeGreaterThan(3);
    expect(row.chunks[2]!.fg).not.toEqual(row.chunks.at(-1)!.fg);
    t.app.setTheme('mono'); await t.renderOnce();
    expect(row.chunks[2]!.fg).toEqual(row.chunks.at(-1)!.fg);
    expect(t.app.model.selected?.message).toBe('Failure');
  } finally { t.app.dispose(); await t.dispose(); }
});

test('automatic palette updates apply live while an explicit mode stays fixed', async () => {
  const t = await setup({ detectTerminalTheme: true });
  try {
    t.renderer.emit('palette', { defaultBackground: '#f4e8d0', defaultForeground: '#000000', palette: [] });
    expect(t.app.theme.background).toBe('#f4e8d0');
    t.app.setTheme('dark');
    t.renderer.emit('palette', { defaultBackground: '#ffffff', palette: [] });
    expect(t.app.theme.background).toBe('#101923');
    t.app.setTheme('auto');
    expect(t.app.theme.background).toBe('#ffffff');
  } finally { t.app.dispose(); await t.dispose(); }
});

test('native severity letters use the same styles as full names without rewriting data', async () => {
  const t = await setup();
  try {
    t.app.model.clear();
    for (const [alias, name] of [['E', 'ERROR'], ['W', 'WARN'], ['F', 'FATAL'], ['A', 'FATAL'], ['D', 'DEBUG'], ['V', 'VERBOSE']]) {
      t.app.ingest([{ timestamp: '2026-11-03T12:00:02Z', level: alias, message: 'alias' }, { timestamp: '2026-11-03T12:00:02Z', level: name, message: 'full' }]);
      await t.renderOnce();
      const rows = t.app.controls.rows.filter(r => r.chunks.some(c => c.text === 'alias' || c.text === 'full'));
      const a = rows.at(-2)!.chunks[2]!, b = rows.at(-1)!.chunks[2]!;
      expect(a.fg).toEqual(b.fg); expect(a.attributes).toEqual(b.attributes);
      expect(a.text.trim()).toBe(alias);
      t.app.model.clear();
    }
  } finally { t.app.dispose(); await t.dispose(); }
});

test('JavaScript console runs only explicit expressions while log capture continues', async () => {
  let executions = 0, releases = 0;
  const device = { id: 'p', name: 'Phone', platform: 'android' as const, state: 'connected', webview: { id: 'v', socket: 's', title: 'Shop', url: 'https://example.test' } };
  const runtime = { enable: async () => {}, state: () => ({ revision: 1, connected: true, contexts: [{ key: 'main', name: '', url: '', frame: '', top: true }] }),
    evaluate: async () => { executions++; return { revision: 1, exception: false, elapsed: 1, value: { type: 'number', text: '42' } }; },
    properties: async () => ({ revision: 1, children: [], total: 0 }), releaseOwner() {} };
  const t = await setup({ demo: false, sources: async () => [device], acquireConsole: async () => ({ runtime, release() { releases++; } }) });
  try {
    expect(t.captureCharFrame()).toContain('JavaScript console · Alpha');
    t.app.openConsole(); await t.renderOnce();
    expect(t.captureCharFrame()).toContain('JavaScript console · Alpha');
    const panel = t.app.consolePanel!;
    await panel.model.connect(device); panel.model.chooseContext('main');
    panel.input.focus(); await t.mockInput.typeText('21*2');
    expect(executions).toBe(0);
    t.mockInput.pressEnter(); await Promise.resolve(); await t.renderOnce();
    expect(executions).toBe(1); expect(t.captureCharFrame()).toContain('42');
    t.app.ingest([{ timestamp: 'now', message: 'background capture' }]);
    expect(t.app.model.rows().some(r => r.message === 'background capture')).toBe(true);
    t.mockInput.pressEscape(); await new Promise(resolve => setTimeout(resolve, 50));
    expect(t.app.consolePanel).toBeUndefined(); expect(releases).toBe(1);
  } finally { t.app.dispose(); await t.dispose(); }
});

test('console input remains on screen in all languages and narrow terminals', async () => {
  for (const locale of ['en', 'de', 'es', 'fr', 'it', 'ja', 'zh-CN'] as const) {
    const t = await setup({ locale, sources: async () => [], acquireConsole: async () => { throw new Error('unused'); } });
    try {
      t.app.openConsole();
      for (const width of [70, 120]) {
        t.resize(width, 30); await t.renderOnce();
        const input = t.app.consolePanel!.input;
        expect(input.y).toBeGreaterThan(8); expect(input.y).toBeLessThan(29);
      }
    } finally { t.app.dispose(); await t.dispose(); }
  }
});

test('source discovery refreshes automatically and removes only vanished selected targets', async () => {
  const phone = { id: 'p', name: 'Phone', platform: 'android' as const, state: 'connected' };
  const oldView = { ...phone, webview: { id: 'old', socket: 's', title: 'Old page', url: '' } };
  const newView = { ...phone, webview: { id: 'new', socket: 's', title: 'New page', url: '' } };
  let devices = [phone, oldView], calls = 0;
  const selected: string[][] = [];
  const t = await setup({ demo: false, sourceRefreshMs: 20, sources: async () => { calls++; return devices; }, syncSources: d => selected.push(d.map(s => s.webview?.id || s.id)) });
  try {
    await t.app.refreshSources(); t.app.toggleSource(phone); t.app.toggleSource(oldView);
    devices = [phone, newView];
    await new Promise(r => setTimeout(r, 70)); await t.renderOnce();
    expect(calls).toBeGreaterThan(1);
    expect(selected.at(-1)).toEqual(['p']);
    expect(t.captureCharFrame()).toContain('New page');
    expect(t.captureCharFrame()).not.toContain('Old page');
    devices = [phone]; await t.app.refreshSources(); await t.renderOnce();
    expect(t.captureCharFrame()).not.toContain('New page');
  } finally { t.app.dispose(); await t.dispose(); }
  const after = calls; await new Promise(r => setTimeout(r, 50)); expect(calls).toBe(after);
});

test('discovery coalesces overlapping requests and ignores completion after disposal', async () => {
  let complete!: (devices: any[]) => void, calls = 0, syncs = 0;
  const t = await setup({ sources: () => { calls++; return new Promise(resolve => { complete = resolve; }); }, syncSources() { syncs++; } });
  const first = t.app.refreshSources(), second = t.app.refreshSources();
  expect(first).toBe(second); expect(calls).toBe(1);
  t.app.dispose(); complete([{ id: 'p', name: 'Phone', platform: 'android', state: 'connected' }]);
  await first; expect(syncs).toBe(0); await t.dispose();
});

test('an open console WebView picker reflects refreshed sources', async () => {
  const phone = { id: 'p', name: 'Phone', platform: 'android' as const, state: 'connected' };
  let devices = [{ ...phone, webview: { id: 'old', socket: 's', title: 'Old page', url: '' } }];
  const t = await setup({ sources: async () => devices, syncSources() {}, acquireConsole: async () => { throw new Error('unused'); } });
  try {
    t.app.openConsole(); await t.app.consolePanel!.chooseTarget(); await t.renderOnce();
    expect(t.captureCharFrame()).toContain('Old page');
    devices = [{ ...phone, webview: { id: 'new', socket: 's', title: 'New page', url: '' } }];
    await t.app.refreshSources(); await t.renderOnce();
    expect(t.captureCharFrame()).toContain('New page'); expect(t.captureCharFrame()).not.toContain('Old page');
    devices = []; await t.app.refreshSources(); await t.renderOnce();
    expect(t.captureCharFrame()).not.toContain('New page');
  } finally { t.app.dispose(); await t.dispose(); }
});

test('retained logs keep parent ownership after all selected sources disappear', async () => {
  const phone = { id: 'p', name: 'Phone', platform: 'android' as const, state: 'connected' };
  let devices = [phone];
  const t = await setup({ sources: async () => devices, syncSources() {} });
  try {
    await t.app.refreshSources(); t.app.toggleSource(phone);
    t.app.ingest([{ timestamp: 'now', message: 'old-device-record' }]);
    devices = []; await t.app.refreshSources();
    expect(t.app.model.rows().some(r => r.message === 'old-device-record')).toBe(true);
    const other = { ...phone, id: 'other', name: 'Other phone' };
    devices = [other]; await t.app.refreshSources(); t.app.toggleSource(other);
    expect(t.app.model.rows()).toHaveLength(0);
  } finally { t.app.dispose(); await t.dispose(); }
});

test('refresh keeps a focused source visible when new WebViews are inserted before it', async () => {
  const phone = { id: 'p', name: 'Phone', platform: 'android' as const, state: 'connected' };
  const view = (id: string) => ({ ...phone, webview: { id, socket: 's', title: id, url: '' } });
  const old = view('old'); let devices = [phone, old];
  const t = await setup({ sources: async () => devices, syncSources() {} });
  try {
    t.resize(70, 30); await t.app.refreshSources(); t.app.toggleSource(old); await t.renderOnce();
    devices = [phone, ...Array.from({ length: 12 }, (_, i) => view(`new-${i}`)), old];
    await t.app.refreshSources(); await t.renderOnce();
    const focused = t.renderer.currentFocusedRenderable!;
    const sidebar = t.app.controls.sidebar;
    expect(focused.y).toBeGreaterThanOrEqual(sidebar.y + 1);
    expect(focused.y + focused.height).toBeLessThanOrEqual(sidebar.y + sidebar.height - 1);
  } finally { t.app.dispose(); await t.dispose(); }
});

test('refresh keeps a focused JS target visible after insertion', async () => {
  const phone = { id: 'p', name: 'Phone', platform: 'android' as const, state: 'connected' };
  const view = (id: string) => ({ ...phone, webview: { id, socket: 's', title: id, url: '' } });
  const old = view('old'); let devices = [old];
  const t = await setup({ sources: async () => devices, syncSources() {}, acquireConsole: async () => { throw new Error('unused'); } });
  try {
    t.resize(70, 24); t.app.openConsole(); await t.app.consolePanel!.chooseTarget(); await t.renderOnce();
    t.mockInput.pressTab(); await t.renderOnce();
    devices = [...Array.from({ length: 12 }, (_, i) => view(`new-${i}`)), old];
    await t.app.refreshSources(); await t.renderOnce();
    const focused = t.renderer.currentFocusedRenderable!;
    expect(focused.id).toBe('console-choice-12');
    expect(focused.y).toBeGreaterThanOrEqual(1);
    expect(focused.y + focused.height).toBeLessThanOrEqual(23);
  } finally { t.app.dispose(); await t.dispose(); }
});

test('reselecting a source resumes an empty frozen view while keeping the search', async () => {
  const device = { id: 'p', name: 'Phone', platform: 'android' as const, state: 'connected' };
  const source = { key: JSON.stringify(['android', 'p', undefined, undefined]), name: 'Phone', platform: 'android' as const, deviceId: 'p' };
  const t = await setup({ sources: async () => [device], syncSources() {} });
  try {
    await t.app.refreshSources(); t.app.toggleSource(device); t.app.model.clear();
    t.app.setQuery('message');
    t.app.ingest([{ timestamp: '2026-11-03T12:00:00Z', message: 'first message', source }]);
    t.app.model.select(t.app.model.rows()[0]!.key);
    t.app.toggleSource(device); expect(t.app.model.rows()).toHaveLength(0);
    t.app.toggleSource(device);
    t.app.ingest([{ timestamp: '2026-11-03T12:00:01Z', message: 'new message', source }]);
    expect(t.app.model.paused).toBe(false);
    expect(t.app.model.selected).toBeUndefined();
    expect(t.app.model.query).toBe('message');
    expect(t.app.model.rows().map(r => r.message)).toEqual(['new message']);
  } finally { t.app.dispose(); await t.dispose(); }
});

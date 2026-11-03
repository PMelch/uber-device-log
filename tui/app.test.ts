import { test, expect } from 'bun:test';
import type { TextRenderable } from '@opentui/core';
import { createTestRenderer } from '@opentui/core/testing';
import { createTui, type TuiOptions } from './app';

async function setup(options: TuiOptions = {}) {
  const terminal = await createTestRenderer({ width: 100, height: 30 });
  const app = createTui(terminal.renderer, { locale: 'en', ...options });
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

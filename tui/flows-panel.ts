import { createFlowSourcesPanel } from './flow-sources-panel';
import { BoxRenderable, TextRenderable, InputRenderable, InputRenderableEvents, ScrollBoxRenderable, ScrollBarRenderable,
  StyledText, fg, bold, type CliRenderer, type Renderable, type KeyEvent } from '@opentui/core';
import type { FlowInstance, FlowOutcome } from '../shared/flow-types';
import { flowPresentation, flowErrorCode } from '../shared/flow-presentation';
import { translate, translateMessage, type Locale } from '../src/i18n';
import type { MessageKey } from '../src/i18n/en';
import type { createTuiTheme } from './theme';
import type { TuiFlows } from './flows-model';
import { terminalText } from './model';

const outcomeKeys: Record<FlowOutcome, MessageKey> = { running: 'flowsStatusRunning', completed: 'flowsStatusCompleted', failed: 'flowsStatusFailed', cancelled: 'flowsStatusCancelled', timed_out: 'flowsStatusTimedOut', interrupted: 'flowsStatusInterrupted' };
const outcomeGlyphs: Record<FlowOutcome, string> = { running: '●', completed: '✓', failed: '×', cancelled: '–', timed_out: '◷', interrupted: '■' };
const completenessKeys = { missing_start: 'flowsCompletenessMissingStart', missing_steps: 'flowsCompletenessMissingSteps', capture_gap: 'flowsCompletenessCaptureGap', ambiguous: 'flowsCompletenessAmbiguous' } as const;
export function createFlowsPanel(renderer: CliRenderer, options: {
  flows: TuiFlows; locale(): Locale; colors(): ReturnType<typeof createTuiTheme>; close(): void;
}) {
  const t = (key: MessageKey) => translate(options.locale(), key);
  let disposed = false, info = false, selectedId = '', observation = 0, reveal = false, raw = false, query = '';
  let sourcesPanel: ReturnType<typeof createFlowSourcesPanel> | undefined;
  const presentations = new WeakMap<FlowInstance, ReturnType<typeof flowPresentation>>();
  function presentation(instance: FlowInstance) { let value = presentations.get(instance); if (!value) { value = flowPresentation(instance); presentations.set(instance, value); } return value; }
  const actions = new Map<Renderable, () => void>();
  const labels = new Map<TextRenderable, () => string>();
  const focus: Renderable[] = [];
  const root = new BoxRenderable(renderer, { id: 'flows-panel', width: '100%', height: '100%', paddingX: 1, backgroundColor: options.colors().background }); renderer.root.add(root);
  const heading = new TextRenderable(renderer, { height: 1, flexShrink: 0 }); root.add(heading);
  const toolbar = new BoxRenderable(renderer, { flexDirection: 'row', flexWrap: 'wrap', minHeight: 3, height: 'auto', flexShrink: 0, gap: 1 }); root.add(toolbar);
  function button(parent: BoxRenderable, id: string, label: () => string, action: () => void) {
    const box = new BoxRenderable(renderer, { id, height: 3, maxWidth: '100%', minWidth: 0, flexShrink: 0, border: true, paddingX: 1, focusable: true,
      onMouseDown(event) { if (event.button !== 0) return; event.stopPropagation(); event.preventDefault(); box.focus(); action(); } });
    const text = new TextRenderable(renderer, { height: 1, wrapMode: 'none', selectable: false });
    box.add(text); parent.add(box); focus.push(box); actions.set(box, action); labels.set(text, label); return box;
  }
  const close = button(toolbar, 'flows-close', () => t('close'), options.close);
  const sourcesButton = button(toolbar, 'flows-sources', () => t('flowsBlueprintSources'), () => {
    if (!options.flows.sources || sourcesPanel) return;
    root.visible = false;
    sourcesPanel = createFlowSourcesPanel(renderer, { ...options, close() { sourcesPanel?.dispose(); sourcesPanel = undefined; root.visible = true; sourcesButton.focus(); update(); } });
  });
  sourcesButton.visible = !!options.flows.sources;
  const back = button(toolbar, 'flows-back', () => t('flowsBack'), () => { info = false; selectedId = ''; reveal = raw = false; update(); flowList.box.focus(); });
  button(toolbar, 'flows-info', () => t('flowsInfo'), () => { info = !info; update(); if (info) information.focus(); });
  const reloadButton = button(toolbar, 'flows-reload', () => t('flowsReload'), () => { void options.flows.reload(); });
  const clearButton = button(toolbar, 'flows-clear', () => t('flowsClear'), () => { selectedId = ''; reveal = raw = false; options.flows.clear(); update(); });
  const restart = button(toolbar, 'flows-restart', () => t('flowsRestart'), () => options.flows.restart());
  const status = new TextRenderable(renderer, { height: 'auto', maxHeight: 3, flexShrink: 0, wrapMode: 'word' }); root.add(status);
  const searchFrame = new BoxRenderable(renderer, { border: true, height: 3, flexShrink: 0 }); root.add(searchFrame);
  const search = new InputRenderable(renderer, { id: 'flows-search', width: '100%', maxLength: 500 }); searchFrame.add(search); focus.push(search);
  search.on(InputRenderableEvents.INPUT, () => { query = search.value; flowList.reset(); update(); });
  // Slot-based lists keep renderable counts bounded even at the engine's 2500-instance limit.
  function virtualList<T>(parent: BoxRenderable, id: string, height: number, identity: (item: T, index: number) => string,
    text: (item: T, active: boolean) => StyledText | string, select: (item: T, index: number) => void) {
    let items: T[] = [], offset = 0, cursor = 0, busy = false, engaged = false;
    const box = new BoxRenderable(renderer, { id, border: true, focusable: true, minHeight: 3, flexGrow: 1, flexDirection: 'row',
      onMouseScroll(event) { if (!event.scroll) return; event.preventDefault(); event.stopPropagation(); box.focus(); move(event.scroll.direction === 'up' ? -3 : 3); },
      onSizeChange() { if (!disposed) draw(); } }); parent.add(box); focus.push(box);
    const body = new BoxRenderable(renderer, { flexGrow: 1, minWidth: 0, height: '100%', overflow: 'hidden' }); box.add(body);
    const bar = new ScrollBarRenderable(renderer, { width: 1, height: '100%', orientation: 'vertical', onChange(value) { if (busy) return; engaged = true; offset = Math.round(value); cursor = offset; draw(); } }); box.add(bar);
    const rows: TextRenderable[] = [];
    function draw() {
      if (disposed) return;
      const count = Math.max(1, Math.floor((box.height - 2) / height));
      while (rows.length > count) { const row = rows.pop()!; actions.delete(row); row.destroy(); }
      while (rows.length < count) {
        const slot = rows.length;
        const row = new TextRenderable(renderer, { id: `${id === 'flow-list' ? 'flow-row' : 'flow-event'}-${slot}`, width: '100%', height, flexShrink: 0, wrapMode: 'none', selectable: false,
          onMouseDown(event) { if (event.button !== 0) return; event.preventDefault(); event.stopPropagation(); box.focus(); cursor = offset + slot; activate(); } });
        body.add(row); rows.push(row); actions.set(row, () => { cursor = offset + slot; activate(); });
      }
      cursor = Math.max(0, Math.min(cursor, items.length - 1));
      offset = Math.max(0, Math.min(offset, items.length - count));
      busy = true; bar.scrollSize = items.length; bar.viewportSize = count; bar.scrollPosition = offset; busy = false;
      const colors = options.colors(); box.borderColor = colors.border; box.focusedBorderColor = colors.accent;
      bar.trackOptions = { foregroundColor: colors.muted, backgroundColor: colors.background };
      for (let slot = 0; slot < rows.length; slot++) {
        const item = items[offset + slot], row = rows[slot]!;
        row.bg = offset + slot === cursor && item ? colors.selected : colors.background;
        row.fg = colors.text; row.content = item ? text(item, offset + slot === cursor) : '';
      }
    }
    function move(delta: number) {
      engaged = true;
      cursor = Math.max(0, Math.min(items.length - 1, cursor + delta));
      if (cursor < offset) offset = cursor;
      if (cursor >= offset + rows.length) offset = cursor - rows.length + 1;
      draw();
    }
    function activate() { engaged = true; if (items[cursor]) select(items[cursor]!, cursor); }
    return { box, draw, reset() { offset = cursor = 0; engaged = false; }, key(key: KeyEvent) {
      if (key.name === 'return') { activate(); return; }
      const delta = key.name === 'up' ? -1 : key.name === 'down' ? 1 : key.name === 'pageup' ? -rows.length : key.name === 'pagedown' ? rows.length : key.name === 'home' ? -items.length : key.name === 'end' ? items.length : 0;
      if (delta) move(delta);
    }, set(next: T[]) {
      const current = engaged && items[cursor] ? identity(items[cursor]!, cursor) : undefined; const nextCursor = current === undefined ? -1 : next.findIndex((item, index) => identity(item, index) === current);
      items = next;
      if (nextCursor >= 0) { const shift = nextCursor - cursor; cursor = nextCursor; offset += shift; }
      draw();
    } };
  }
  function tone(instance: FlowInstance) { const c = options.colors(); return instance.outcome === 'failed' ? c.error : instance.outcome === 'running' || instance.outcome === 'completed' ? c.accent : c.warn; }
  function label(instance: FlowInstance) { return presentation(instance).label.map(part => part.sensitive ? t('flowsSensitive') : part.text).join(''); }
  const flowList = virtualList<FlowInstance>(root, 'flow-list', 3, item => item.id, (item, active) => {
    const c = options.colors(); const incomplete = item.completeness === 'complete' ? '' : ` · ${t(completenessKeys[item.completeness])}`;
    return new StyledText([fg(c.accent)(active ? '▸ ' : '  '), bold(fg(c.text)(terminalText(label(item)))), fg(c.muted)(`\n  ${terminalText(item.id)} · ${terminalText(item.deviceId || item.observations[0]?.message.source?.name || '—')} · ${translate(options.locale(), 'flowsPriorityValue', { priority: item.blueprint.priority ?? 3 })}\n  `), fg(tone(item))(`${outcomeGlyphs[item.outcome]} ${t(outcomeKeys[item.outcome])}`), fg(c.muted)(incomplete)]);
  }, item => { selectedId = item.id; observation = 0; reveal = raw = false; timeline.reset(); inspector.scrollTo(0); update(); timeline.box.focus(); });
  const empty = new TextRenderable(renderer, { height: 'auto', flexShrink: 0, wrapMode: 'word' }); root.add(empty);
  const summary = new TextRenderable(renderer, { height: 'auto', maxHeight: 4, flexShrink: 0, wrapMode: 'word' }); root.add(summary);
  const detail = new BoxRenderable(renderer, { flexGrow: 1, minHeight: 4, gap: 1 }); root.add(detail);
  const timeline = virtualList<FlowInstance['observations'][number]>(detail, 'flow-timeline', 2,
    (_item, index) => String(index), item => {
      const instance = options.flows.state.instances.find(row => row.id === selectedId)!;
      const name = instance.blueprint.steps.find(step => step.id === item.stepId)?.name ?? item.stepId;
      const c = options.colors();
      return new StyledText([fg(item.accepted === false ? c.warn : c.accent)(item.accepted === false ? '○ ' : '✓ '), bold(fg(c.text)(terminalText(name))), fg(c.muted)(`\n  ${terminalText(item.message.timestamp.slice(11, 23))} · ${terminalText(item.message.source?.name || instance.deviceId || '—')}`)]);
    }, (_item, index) => { observation = index; reveal = raw = false; inspector.scrollTo(0); update(); });
  const evidence = new BoxRenderable(renderer, { flexGrow: 1, minHeight: 3, minWidth: 0 }); detail.add(evidence);
  const evidenceToolbar = new BoxRenderable(renderer, { flexDirection: 'row', flexWrap: 'wrap', minHeight: 3, height: 'auto', flexShrink: 0, gap: 1 }); evidence.add(evidenceToolbar);
  const rawButton = button(evidenceToolbar, 'flow-raw', () => t(raw ? 'flowsPayload' : 'flowsRawLog'), () => { raw = !raw; inspector.scrollTo(0); update(); });
  const revealButton = button(evidenceToolbar, 'flow-reveal', () => t(reveal ? 'flowsHide' : 'flowsReveal'), () => { reveal = !reveal; update(); });
  const inspector = new ScrollBoxRenderable(renderer, { id: 'flow-inspector', border: true, flexGrow: 1, minHeight: 2, scrollY: true, scrollX: false }); evidence.add(inspector); focus.push(inspector);
  const payload = new TextRenderable(renderer, { width: '100%', wrapMode: 'word', selectable: true }); inspector.add(payload);
  const information = new ScrollBoxRenderable(renderer, { id: 'flows-information', border: true, flexGrow: 1, minHeight: 3, scrollY: true, scrollX: false }); root.add(information); focus.push(information);
  const informationText = new TextRenderable(renderer, { width: '100%', wrapMode: 'word', selectable: true }); information.add(informationText);
  const help = new TextRenderable(renderer, { height: 2, flexShrink: 0, wrapMode: 'word' }); root.add(help);
  function visible(node: Renderable) { let current: Renderable | null = node; while (current) { if (!current.visible) return false; current = current.parent as Renderable | null; } return true; }
  function update() {
    if (disposed) return;
    if (sourcesPanel) { sourcesPanel.update(); return; }
    const c = options.colors(), flows = options.flows;
    const selected = flows.state.instances.find(item => item.id === selectedId);
    if (selectedId && !selected) { selectedId = ''; reveal = raw = false; flowList.box.focus(); }
    const showDetail = !!selected;
    root.backgroundColor = c.background;
    heading.content = `${t('flowsWorkspace')}${flows.snapshot?.projectName ? ' · ' + terminalText(flows.snapshot.projectName) : ''}`; heading.fg = c.accent;
    back.visible = showDetail || info; reloadButton.visible = clearButton.visible = !showDetail && !info; restart.visible = flows.error?.code === 'flowsWorkerError'; searchFrame.visible = flowList.box.visible = !showDetail && !info;
    detail.visible = summary.visible = showDetail && !info;
    information.visible = info; information.title = t('flowsInfo'); information.borderColor = c.border; informationText.fg = c.text;
    help.content = t('tuiFlowsHelp'); help.fg = c.muted;
    searchFrame.title = t('literalSearch'); searchFrame.borderColor = c.border; search.placeholder = t('flowsSearch');
    search.textColor = search.focusedTextColor = c.text; search.backgroundColor = c.panel; search.focusedBackgroundColor = c.selected; search.placeholderColor = c.muted; search.cursorColor = c.text;
    for (const [text, value] of labels) { text.content = value(); text.fg = c.text; const box = text.parent as BoxRenderable; box.backgroundColor = c.background; box.borderColor = c.border; box.focusedBorderColor = c.accent; }
    const diagnostics = flows.snapshot?.diagnostics ?? [];
    if (info) informationText.content = terminalText([
      flows.snapshot?.directory ?? '',
      ...diagnostics.map(d => translateMessage(options.locale(), d)),
      ...flows.snapshot?.blueprints.map(blueprint => `${blueprint.name} (${blueprint.id})\n${blueprint.description ?? ''}\n${translate(options.locale(), 'flowsTimeout', { timeout: blueprint.timeout })}`) ?? [],
    ].filter(Boolean).join('\n\n'));
    status.fg = flows.error || diagnostics.length || flows.state.gaps ? c.warn : c.muted;
    status.content = terminalText([flows.loading ? t('flowsLoading') : `${t('flowsBlueprints')}: ${flows.snapshot?.blueprints.length ?? 0} · ${t('flowsTabFlows')}: ${flows.state.instances.length}`,
      flows.error ? translateMessage(options.locale(), flows.error) : '', flows.state.gaps ? translate(options.locale(), 'flowsGap', { count: flows.state.gaps }) : '',
      ...diagnostics.slice(0, 1).map(d => translateMessage(options.locale(), d))].filter(Boolean).join('\n'));
    const needle = query.trim().toLocaleLowerCase(options.locale());
    const rows = [...flows.state.instances].reverse().filter(item => !needle || `${label(item)} ${item.id} ${item.blueprint.name} ${item.deviceId} ${t(outcomeKeys[item.outcome])}`.toLocaleLowerCase(options.locale()).includes(needle));
    flowList.box.title = t('flowsTabFlows'); flowList.set(rows);
    empty.visible = !info && !showDetail && !rows.length;
    empty.fg = c.muted; empty.content = flows.loading ? t('flowsLoading') : needle ? t('flowsNoResults') : !flows.snapshot?.blueprints.length ? `${t('flowsNoBlueprints')}\n${t('flowsReload')}` : `${t('flowsEmpty')}\n${t('flowsEmptyHint')}`;
    // Keep empty-state text near the top rather than below an empty expanding list.
    if (empty.visible) flowList.box.visible = false;
    if (selected) {
      const errorCode = flowErrorCode(selected);
      const errorDetail = [errorCode.sensitive ? t('flowsSensitive') : errorCode.value, selected.errorDescription].filter(Boolean).join(' · ');
      const incomplete = selected.completeness === 'complete' ? '' : ` · ${t(completenessKeys[selected.completeness])}`;
      const seconds = Math.round(Math.max(0, (selected.endedAt ?? Math.max(selected.updatedAt, performance.timeOrigin + performance.now())) - selected.startedAt) / 100) / 10;
      summary.fg = c.text; summary.maxHeight = renderer.height < 28 ? 4 : 7; summary.content = new StyledText([bold(fg(c.text)(terminalText(label(selected)))), fg(tone(selected))(`\n${terminalText(selected.id)} · ${outcomeGlyphs[selected.outcome]} ${t(outcomeKeys[selected.outcome])}${incomplete}`), fg(c.muted)(` · ${translate(options.locale(), 'flowsDuration', { seconds })}\n${t('flowsExpected')}: ${terminalText(selected.expected.map(id => selected.blueprint.steps.find(step => step.id === id)?.name ?? id).join(' → ') || '—')}`), fg(c.error)(errorDetail ? `\n${terminalText(errorDetail)}` : ''), fg(c.muted)(presentation(selected).results.length ? `\n${t('flowsResults')}: ${terminalText(presentation(selected).results.map(result => `${result.field} = ${result.sensitive ? t('flowsSensitive') : typeof result.value === 'string' ? result.value : JSON.stringify(result.value)}`).join(' · '))}` : '')]);
      const wide = renderer.width >= 100;
      detail.flexDirection = wide ? 'row' : 'column';
      timeline.box.width = wide ? '38%' : '100%'; timeline.box.height = wide ? '100%' : renderer.height < 28 ? 4 : 6;
      timeline.box.flexGrow = wide ? 1 : 0; timeline.box.flexShrink = 0;
      evidenceToolbar.gap = 0; rawButton.width = '35%'; revealButton.width = '65%';
      evidence.width = wide ? '60%' : '100%'; evidence.height = wide ? '100%' : 'auto';
      timeline.box.title = t('flowsTimeline'); timeline.set(selected.observations);
      const event = selected.observations[Math.min(observation, selected.observations.length - 1)];
      inspector.title = t(raw ? 'flowsRawLog' : 'flowsPayload'); inspector.borderColor = c.border; payload.fg = c.text;
      if (!event) payload.content = t('flowsChooseStep');
      else if (raw) payload.content = reveal ? terminalText(JSON.stringify(event.message, null, 2)) : t('flowsSensitive');
      else {
        const node = selected.blueprint.steps.find(step => step.id === event.stepId) ?? selected.blueprint.errors?.find(rule => rule.id === event.stepId);
        const safe = Object.fromEntries(Object.entries(event.payload).map(([key, value]) => [key, !reveal && node?.extract?.[key]?.sensitive ? t('flowsSensitive') : value]));
        payload.content = Object.keys(safe).length ? terminalText(JSON.stringify(safe, null, 2)) : t('flowsNoPayload');
      }
    }
  }
  function onKey(key: KeyEvent) {
    if (sourcesPanel) return;
    if (key.name === 'escape') { key.preventDefault(); key.stopPropagation(); if (info) { info = false; update(); close.focus(); } else if (selectedId) { selectedId = ''; reveal = raw = false; update(); flowList.box.focus(); } else options.close(); return; }
    if (key.name === 'tab') {
      key.preventDefault(); key.stopPropagation(); const nodes = focus.filter(visible); const index = nodes.indexOf(renderer.currentFocusedRenderable!);
      nodes[(index + (key.shift ? -1 : 1) + nodes.length) % nodes.length]?.focus(); return;
    }
    const current = renderer.currentFocusedRenderable;
    if ((key.name === 'return' || key.name === 'space') && current && actions.has(current)) { key.preventDefault(); actions.get(current)!(); return; }
    if (current === flowList.box || current === timeline.box) { key.preventDefault(); (current === flowList.box ? flowList : timeline).key(key); }
  }
  renderer.keyInput.on('keypress', onKey); renderer.on('resize', update);
  const unsubscribe = options.flows.subscribe(update);
  const clock = setInterval(() => { if (selectedId && !disposed) update(); }, 1000);
  update(); close.focus();
  return { update, dispose() { sourcesPanel?.dispose(); disposed = true; clearInterval(clock); unsubscribe(); renderer.keyInput.off('keypress', onKey); renderer.off('resize', update); root.destroyRecursively(); actions.clear(); labels.clear(); } };
}

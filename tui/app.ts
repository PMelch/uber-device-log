import { BoxRenderable, InputRenderable, InputRenderableEvents, TextRenderable, ScrollBoxRenderable, ScrollBarRenderable,
  type CliRenderer, type Renderable, type KeyEvent } from '@opentui/core';
import { translate, translateMessage, languages, type Locale, type UiMessage } from '../src/i18n';
import type { MessageKey } from '../src/i18n/en';
import type { Device, LogMessage } from '../shared/types';
import { createLogModel, terminalText } from './model';

export interface TuiOptions {
  locale?: Locale;
  capacity?: number;
  demo?: boolean;
  sources?: () => Promise<Device[]>;
  chooseSource?: (device: Device) => void;
  save?: (messages: LogMessage[]) => Promise<string>;
  quit?: () => void;
}
const colors = { background: '#101923', panel: '#162330', text: '#d8e6ef', muted: '#91a6b7', border: '#38546a', accent: '#70ddd0', selected: '#254659' };

export function createTui(renderer: CliRenderer, options: TuiOptions = {}) {
  const model = createLogModel(options.capacity);
  let locale = options.locale ?? 'en';
  let sourceName = '';
  let status: UiMessage | string = '';
  let capturing = options.demo !== false;
  let offset = 0;
  let cursor = 0;
  let disposed = false;
  let modal: BoxRenderable | undefined;
  let modalFocus: Renderable[] = [];
  let modalScroller: ScrollBoxRenderable | undefined;
  let mainFocus: Renderable[] = [];
  let restoreFocus: Renderable | null = null;
  let sourceRequest = 0;
  let saving = false;
  const labels: { text: TextRenderable; key: MessageKey }[] = [];
  const actions = new Map<Renderable, () => void>();
  const t = (key: MessageKey) => translate(locale, key);
  const root = new BoxRenderable(renderer, { id: 'tui', width: '100%', height: '100%', flexDirection: 'column', backgroundColor: colors.background, paddingX: 1 });
  renderer.root.add(root);
  const heading = new TextRenderable(renderer, { id: 'heading', height: 1, fg: colors.accent, selectable: false });
  root.add(heading);
  const toolbar = new BoxRenderable(renderer, { id: 'toolbar', flexDirection: 'row', flexWrap: 'wrap', height: 'auto', minHeight: 3, flexShrink: 0, gap: 1 });
  root.add(toolbar);
  function button(parent: BoxRenderable, id: string, key: MessageKey, action: () => void, target: Renderable[] = mainFocus) {
    const box = new BoxRenderable(renderer, { id, height: 3, border: true, borderColor: colors.border,
      focusedBorderColor: colors.accent, focusable: true, paddingX: 1, flexShrink: 0,
      onMouseDown(event) {
        if (event.button !== 0) return;
        event.stopPropagation(); event.preventDefault();
        box.focus(); action();
      },
    });
    const text = new TextRenderable(renderer, { content: t(key), fg: colors.text, selectable: false, height: 1 });
    box.add(text); parent.add(box); target.push(box); actions.set(box, action); labels.push({ text, key });
    return { box, text };
  }
  const sources = button(toolbar, 'sources', 'tuiSources', () => { void openSources(); });
  const pause = button(toolbar, 'pause', 'pause', () => {
    if (model.paused) { model.resume(); renderer.clearSelection(); } else model.pause();
    refresh();
  });
  button(toolbar, 'clear', 'clear', () => { model.clear(); offset = 0; cursor = 0; renderer.clearSelection(); refresh(); });
  button(toolbar, 'save', 'tuiSave', () => { void save(); });
  button(toolbar, 'language', 'language', () => {
    locale = languages[(languages.findIndex(item => item.code === locale) + 1) % languages.length]!.code;
    refresh();
  });
  button(toolbar, 'quit', 'tuiQuit', () => options.quit?.());
  const searchBox = new BoxRenderable(renderer, { height: 3, flexShrink: 0, border: true, borderColor: colors.border });
  const search = new InputRenderable(renderer, { id: 'search', width: '100%', placeholder: t('searchPlaceholder'), maxLength: 500,
    textColor: colors.text, backgroundColor: colors.panel, focusedBackgroundColor: colors.selected });
  searchBox.add(search); root.add(searchBox); mainFocus.push(search);
  search.on(InputRenderableEvents.INPUT, () => setQuery(search.value));
  const content = new BoxRenderable(renderer, { id: 'content', flexGrow: 1, minHeight: 4, flexDirection: 'row', gap: 1 });
  root.add(content);
  const logs = new BoxRenderable(renderer, { id: 'logs', width: '60%', height: '100%', border: true, borderColor: colors.border,
    focusedBorderColor: colors.accent, focusable: true, overflow: 'hidden', flexDirection: 'row', flexShrink: 0,
    onMouseScroll(event) {
      if (!event.scroll) return;
      event.stopPropagation(); logs.focus();
      scroll(event.scroll.direction === 'up' ? -3 : event.scroll.direction === 'down' ? 3 : 0);
    },
    onSizeChange() { if (!disposed) refreshRows(); },
  });
  content.add(logs); mainFocus.push(logs);
  const rowContainer = new BoxRenderable(renderer, { flexGrow: 1, minWidth: 0, height: '100%', overflow: 'hidden' });
  logs.add(rowContainer);
  let updatingScrollbar = false;
  const scrollbar = new ScrollBarRenderable(renderer, { id: 'log-scrollbar', orientation: 'vertical', width: 1, height: '100%',
    onChange(position) {
      if (updatingScrollbar) return;
      freeze(); offset = Math.round(position); cursor = Math.max(offset, Math.min(cursor, offset + rows.length - 1)); refresh();
    },
  });
  logs.add(scrollbar);
  const details = new ScrollBoxRenderable(renderer, { id: 'details', flexGrow: 1, height: '100%', minWidth: 0,
    border: true, borderColor: colors.border, focusedBorderColor: colors.accent, scrollX: false, scrollY: true });
  const detailText = new TextRenderable(renderer, { id: 'detail-text', width: '100%', wrapMode: 'word', fg: colors.text, selectable: true });
  details.add(detailText); content.add(details); mainFocus.push(details);
  const stateLine = new TextRenderable(renderer, { height: 1, fg: colors.accent, selectable: false });
  const statusLine = new TextRenderable(renderer, { height: 1, fg: colors.muted, selectable: false });
  const help = new TextRenderable(renderer, { height: 2, fg: colors.muted, wrapMode: 'word', selectable: false });
  root.add(stateLine); root.add(statusLine); root.add(help);
  const rows: TextRenderable[] = [];

  function freeze() { if (!model.paused) model.pause(); }
  function scroll(delta: number) {
    if (!delta) return;
    freeze(); offset = Math.max(0, Math.min(Math.max(0, model.rows().length - rows.length), offset + delta));
    cursor = Math.max(offset, Math.min(offset + rows.length - 1, cursor));
    refresh();
  }
  function choose(index: number) {
    const row = model.rows()[index];
    if (!row) return;
    model.select(row.key); cursor = index; details.scrollTo(0); refresh();
  }
  function refreshRows() {
    if (disposed) return;
    const size = Math.max(1, logs.height - 2);
    while (rows.length > size) rows.pop()!.destroy();
    while (rows.length < size) {
      const slot = rows.length;
      const row = new TextRenderable(renderer, { id: `row-${slot}`, width: '100%', height: 1, flexShrink: 0,
        selectable: false, wrapMode: 'none', fg: colors.text,
        onMouseDown(event) {
          if (event.button !== 0) return;
          event.stopPropagation(); event.preventDefault(); logs.focus(); choose(offset + slot);
        },
      });
      rowContainer.add(row); rows.push(row);
    }
    const items = model.rows();
    if (!model.paused) { offset = Math.max(0, items.length - size); cursor = Math.max(0, items.length - 1); }
    offset = Math.min(offset, Math.max(0, items.length - size));
    cursor = Math.max(0, Math.min(cursor, items.length - 1));
    updatingScrollbar = true;
    try { scrollbar.scrollSize = items.length; scrollbar.viewportSize = size; scrollbar.scrollPosition = offset; }
    finally { updatingScrollbar = false; }
    const selected = model.selected;
    for (let i = 0; i < rows.length; i++) {
      const record = items[offset + i];
      const line = rows[i]!;
      line.bg = record && (record.key === selected?.key || offset + i === cursor) ? colors.selected : colors.background;
      line.fg = record?.level === 'ERROR' || record?.level === 'FATAL' ? '#ff9f99' : record?.level === 'WARN' ? '#f1ce7a' : colors.text;
      line.content = record ? terminalText(`${record.key === selected?.key ? '●' : ' '} ${record.timestamp.slice(11, 23)} ${(record.level ?? '-').padEnd(5)} ${record.tag ?? ''} ${record.message.replace(/\n/g, ' ↵ ')}`)
        : i === 0 ? t(model.query ? 'noMatches' : 'waiting') : '';
    }
    logs.title = `${t('logStream')} · ${translate(locale, 'messageCount', { count: items.length })}`;
  }
  function refresh() {
    if (disposed) return;
    for (const label of labels) label.text.content = t(label.key);
    heading.content = `Über Device Log · ${t('tuiPrototype')}`;
    sources.text.content = t(options.demo === false ? 'tuiSources' : 'tuiDemo');
    pause.text.content = t(model.paused ? 'backToLive' : 'pause');
    searchBox.title = t('literalSearch'); search.placeholder = t('searchPlaceholder');
    details.title = t('message');
    const selected = model.selected;
    detailText.content = selected ? terminalText(JSON.stringify({ timestamp: selected.timestamp, level: selected.level, tag: selected.tag, pid: selected.pid, source: selected.source, truncated: selected.truncated }, null, 2) + '\n\n' + selected.message) : t('tuiInspectHint');
    stateLine.content = `${t(model.paused ? capturing ? 'pausedActive' : 'pausedStopped' : capturing ? 'liveCapture' : 'notCapturing')} · ${translate(locale, 'messageCount', { count: model.liveCount })}`;
    statusLine.content = terminalText(translateMessage(locale, status) || sourceName);
    help.content = t('tuiHelp');
    refreshRows();
  }
  function layout() {
    const wide = renderer.width >= 100;
    content.flexDirection = wide ? 'row' : 'column';
    logs.width = wide ? '60%' : '100%'; logs.height = wide ? '100%' : '55%';
    details.width = wide ? 0 : '100%'; details.height = wide ? '100%' : 'auto'; details.flexBasis = 0;
    refresh();
  }
  function setQuery(query: string) { model.setQuery(query); offset = 0; cursor = 0; refresh(); }
  async function save() {
    if (!options.save || saving) return;
    saving = true;
    const selected = model.selected;
    try { status = { code: 'tuiSaved', params: { path: await options.save(selected ? [selected] : model.rows()) } }; }
    catch (error) { status = { code: 'tuiFailure', params: { detail: String(error) } }; }
    finally { saving = false; refresh(); }
  }
  function closeModal() {
    sourceRequest++;
    if (!modal) return;
    const removed = new Set(modalFocus);
    for (const node of removed) actions.delete(node);
    for (let i = labels.length - 1; i >= 0; i--) if (removed.has(labels[i]!.text.parent as Renderable)) labels.splice(i, 1);
    modal.destroyRecursively(); modal = undefined; modalFocus = []; modalScroller = undefined;
    restoreFocus?.focus();
  }
  async function openSources() {
    if (!options.sources || modal) return;
    restoreFocus = renderer.currentFocusedRenderable;
    modal = new BoxRenderable(renderer, { id: 'source-dialog', position: 'absolute', top: 1, left: 1, width: '95%', height: '85%',
      zIndex: 20, border: true, title: t('tuiSources'), backgroundColor: colors.panel, borderColor: colors.accent, padding: 1 });
    // Cover the underlying view so mouse and keyboard cannot change capture behind the dialog.
    root.visible = false;
    renderer.root.add(modal);
    button(modal, 'close-sources', 'close', () => { root.visible = true; closeModal(); }, modalFocus);
    modalFocus[0]!.focus();
    const loading = new TextRenderable(renderer, { content: t('waiting'), fg: colors.text, height: 1 });
    modal.add(loading);
    const request = ++sourceRequest;
    try {
      const devices = await options.sources();
      if (disposed || !modal || request !== sourceRequest) return;
      loading.content = devices.length ? '' : t('noDevices');
      const list = new ScrollBoxRenderable(renderer, { flexGrow: 1, scrollX: false, scrollY: true });
      modal.add(list); modalScroller = list;
      devices.forEach((device, index) => {
        const item = button(list, `source-${index}`, 'select', () => {
          sourceName = device.webview?.title || device.name;
          root.visible = true; closeModal(); model.clear(); model.resume(); offset = 0; cursor = 0;
          options.chooseSource?.(device); refresh();
        }, modalFocus);
        item.text.content = terminalText(device.webview ? `${device.name} / ${device.webview.title || device.webview.id}` : `${device.name} (${device.platform})`);
        // Source titles are original data, not translation keys.
        labels.splice(labels.findIndex(label => label.text === item.text), 1);
      });
    } catch (error) {
      if (!disposed && modal && request === sourceRequest) loading.content = terminalText(translate(locale, 'tuiFailure', { detail: String(error) }));
    }
  }
  function onKey(key: KeyEvent) {
    if (key.name === 'tab') {
      key.preventDefault(); key.stopPropagation();
      const focus = modal ? modalFocus : mainFocus;
      let active = renderer.currentFocusedRenderable;
      while (active && !focus.includes(active)) active = active.parent as Renderable | null;
      const current = focus.indexOf(active!);
      const next = focus[(current + (key.shift ? -1 : 1) + focus.length) % focus.length];
      next?.focus();
      if (modalScroller && next && next.id !== 'close-sources') {
        const top = modalScroller.y;
        const bottom = top + modalScroller.height;
        if (next.y < top) modalScroller.scrollBy(next.y - top);
        else if (next.y + next.height > bottom) modalScroller.scrollBy(next.y + next.height - bottom);
      }
      return;
    }
    if (key.name === 'escape' && modal) { key.preventDefault(); root.visible = true; closeModal(); return; }
    const focused = renderer.currentFocusedRenderable;
    if ((key.name === 'return' || key.name === 'space') && focused && actions.has(focused)) {
      key.preventDefault(); actions.get(focused)!(); return;
    }
    if (focused !== logs) return;
    if (key.name === 'return') { key.preventDefault(); choose(cursor); return; }
    const delta = key.name === 'up' ? -1 : key.name === 'down' ? 1 : key.name === 'pageup' ? -rows.length : key.name === 'pagedown' ? rows.length : 0;
    if (delta || key.name === 'home' || key.name === 'end') {
      key.preventDefault(); freeze();
      cursor = Math.max(0, Math.min(model.rows().length - 1, key.name === 'home' ? 0 : key.name === 'end' ? model.rows().length - 1 : cursor + delta));
      if (cursor < offset) offset = cursor;
      if (cursor >= offset + rows.length) offset = cursor - rows.length + 1;
      refresh();
    }
  }
  renderer.keyInput.on('keypress', onKey);
  renderer.on('resize', layout);
  layout(); mainFocus[0]!.focus();
  return {
    model, controls: { search, logs, pause: pause.box, sources: sources.box, details, rows, scrollbar }, setQuery,
    ingest(messages: LogMessage[]) { if (!disposed) { model.ingest(messages); refresh(); } },
    setStatus(value: UiMessage | string, live = capturing) { status = value; capturing = live; refresh(); },
    dispose() {
      disposed = true; closeModal(); renderer.keyInput.off('keypress', onKey); renderer.off('resize', layout); root.destroyRecursively(); mainFocus = [];
    },
  };
}

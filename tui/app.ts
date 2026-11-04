import { BoxRenderable, InputRenderable, InputRenderableEvents, TextRenderable, ScrollBoxRenderable, ScrollBarRenderable,
  StyledText, fg, bold, type CliRenderer, type Renderable, type KeyEvent } from '@opentui/core';
import { translate, translateMessage, languages, type Locale, type UiMessage } from '../src/i18n';
import type { MessageKey } from '../src/i18n/en';
import type { Device, LogMessage } from '../shared/types';
import { createTuiTheme, tuiThemeModes, type TuiThemeMode, type TerminalThemeColors } from './theme';
import { createFlowsPanel } from './flows-panel';
import type { TuiFlows } from './flows-model';
import { createConsolePanel } from './console-panel';
import type { AcquireConsole } from './console-model';
import { featureStatuses, featureStatusCopy } from '../src/feature-status';
import { bufferSizes, type MessageOrder } from '../src/preferences';
import { logLevel } from '../shared/log-view';
import { sourceKey } from './local-client';
import { createLogModel, terminalText } from './model';

export interface TuiOptions {
  flows?: TuiFlows;
  acquireConsole?: AcquireConsole;
  theme?: TuiThemeMode;
  detectTerminalTheme?: boolean;
  project?: string;
  syncSources?: (devices: Device[]) => void;
  locale?: Locale;
  capacity?: number;
  demo?: boolean;
  sources?: () => Promise<Device[]>;
  sourceRefreshMs?: number;
  chooseSource?: (device: Device) => void;
  save?: (messages: LogMessage[], order: MessageOrder) => Promise<string>;
  quit?: () => void;
}

export function createTui(renderer: CliRenderer, options: TuiOptions = {}) {
  let themeMode = options.theme ?? 'auto';
  let terminalColors: TerminalThemeColors | undefined;
  let colors = createTuiTheme(themeMode);
  const model = createLogModel(options.capacity);
  let locale = options.locale ?? 'en';
  let sourceName = '';
  let available: Device[] = [];
  let selectedSources: Device[] = [];
  let viewParent: Device | undefined;
  let sourceNodes: Renderable[] = [];
  let discovery = 0;
  let discoveryTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingDiscovery: Promise<void> | undefined;
  let sourcesCollapsed = false;
  let fullscreen = false;
  let status: UiMessage | string = '';
  let capturing = options.demo !== false;
  let offset = 0;
  let cursor = 0;
  let disposed = false;
  let pauseBlinkTimer: ReturnType<typeof setInterval> | undefined;
  let pauseHighlighted = false;
  let flowsPanel: ReturnType<typeof createFlowsPanel> | undefined;
  let consolePanel: ReturnType<typeof createConsolePanel> | undefined;
  let modal: BoxRenderable | undefined;
  let settingsPicker: { close(): void; update(): void; onKey(key: KeyEvent): void } | undefined;
  let refreshSettings: (() => void) | undefined;
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
  const toolbar = new BoxRenderable(renderer, { id: 'toolbar', flexDirection: 'row', height: 'auto', minHeight: 3, flexShrink: 0, gap: 1 });
  root.add(toolbar);
  const toolbarActions = new BoxRenderable(renderer, { id: 'toolbar-actions', flexDirection: 'row', flexWrap: 'wrap', flexGrow: 1, flexBasis: 0, minWidth: 0, gap: 1 });
  toolbar.add(toolbarActions);
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
  const sources = button(toolbarActions, 'sources', 'tuiSources', () => { void (options.syncSources ? refreshSources() : openSources()); });
  const pause = button(toolbarActions, 'pause', 'pause', () => {
    if (model.paused) { model.resume(); renderer.clearSelection(); } else model.pause();
    refresh();
  });
  button(toolbarActions, 'clear', 'clear', () => { model.clear(); offset = 0; cursor = 0; renderer.clearSelection(); refresh(); });
  button(toolbarActions, 'save', 'tuiSave', () => { void save(); });
  const collapse = button(toolbarActions, 'toggle-sources', 'tuiHideSources', toggleSources);
  collapse.box.visible = !!options.syncSources;
  const maximize = button(toolbarActions, 'fullscreen', 'tuiFullscreen', toggleFullscreen);
  const fullscreenBar = new BoxRenderable(renderer, { height: 3, flexShrink: 0, visible: false });
  root.add(fullscreenBar);
  button(fullscreenBar, 'exit-fullscreen', 'tuiExitFullscreen', toggleFullscreen);
  const consoleButton = button(toolbarActions, 'javascript-console', 'consoleTitle', openConsole);
  consoleButton.box.visible = !!options.acquireConsole;
  button(toolbarActions, 'settings', 'settings', openSettings);
  const flowsButton = button(toolbarActions, 'flows', 'flowsTabFlows', openFlows);
  flowsButton.box.visible = !!options.flows;
  button(toolbar, 'quit', 'tuiQuit', () => options.quit?.());
  const searchBox = new BoxRenderable(renderer, { height: 3, flexShrink: 0, border: true, borderColor: colors.border });
  const search = new InputRenderable(renderer, { id: 'search', width: '100%', placeholder: t('searchPlaceholder'), maxLength: 500,
    textColor: colors.text, backgroundColor: colors.panel, focusedBackgroundColor: colors.selected });
  searchBox.add(search); root.add(searchBox); mainFocus.push(search);
  search.on(InputRenderableEvents.INPUT, () => setQuery(search.value));
  const content = new BoxRenderable(renderer, { id: 'content', flexGrow: 1, minHeight: 4, flexDirection: 'row', gap: 1 });
  root.add(content);
  const sidebar = new ScrollBoxRenderable(renderer, { id: 'source-sidebar', width: 24, height: '100%', flexShrink: 0,
    border: true, borderColor: colors.border, scrollX: false, scrollY: true, visible: !!options.syncSources,
    onMouseDown(event) {
      if (event.button === 0 && event.y === sidebar.y && event.x >= sidebar.x + 2 && event.x < sidebar.x + 5) {
        event.stopPropagation(); event.preventDefault(); toggleSources(); logs.focus();
      }
    } });
  content.add(sidebar);
  if (options.syncSources) {
    toolbarActions.remove(sources.box); sidebar.add(sources.box);
    sources.box.width = '100%'; sources.box.minWidth = 0;
    mainFocus = mainFocus.filter(node => node !== sources.box);
  }
  const collapsedSources = new BoxRenderable(renderer, { id: 'collapsed-sources', width: 24, height: 3,
    flexShrink: 0, border: true, borderColor: colors.border, visible: false,
    onMouseDown(event) {
      if (event.button === 0 && event.y === collapsedSources.y && event.x >= collapsedSources.x + 2 && event.x < collapsedSources.x + 5) {
        event.stopPropagation(); event.preventDefault(); toggleSources(); logs.focus();
      }
    } });
  content.add(collapsedSources);
  const logs = new BoxRenderable(renderer, { id: 'logs', width: '60%', height: '100%', border: true, borderColor: colors.border,
    focusedBorderColor: colors.accent, focusable: true, overflow: 'hidden', flexDirection: 'row', flexShrink: 0,
    onMouseDown(event) {
      if (event.button === 0 && event.y === logs.y && event.x >= logs.x + 2 && event.x < logs.x + 5) {
        event.stopPropagation(); event.preventDefault(); toggleFullscreen();
      }
    },
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
    if (!model.paused) { offset = model.order === 'top' ? 0 : Math.max(0, items.length - size); cursor = model.order === 'top' ? 0 : Math.max(0, items.length - 1); }
    offset = Math.min(offset, Math.max(0, items.length - size));
    cursor = Math.max(0, Math.min(cursor, items.length - 1));
    updatingScrollbar = true;
    try { scrollbar.scrollSize = items.length; scrollbar.viewportSize = size; scrollbar.scrollPosition = offset; }
    finally { updatingScrollbar = false; }
    const selected = model.selected;
    // Discovery may drop a closed WebView while its captured rows remain visible.
    const sourceKeys = new Set(selectedSources.map(sourceKey));
    for (const item of items) {
      if (sourceKeys.size > 1) break;
      if (item.source) sourceKeys.add(item.source.key);
    }
    const showSource = sourceKeys.size > 1;
    for (let i = 0; i < rows.length; i++) {
      const record = items[offset + i];
      const line = rows[i]!;
      line.bg = record && (record.key === selected?.key || offset + i === cursor) ? colors.selected : colors.background;
      line.fg = colors.text;
      if (record) {
        const normalizedLevel = logLevel(record.level);
        const severity = normalizedLevel === 'ERROR' || normalizedLevel === 'FATAL' ? colors.error
          : normalizedLevel === 'WARN' ? colors.warn : normalizedLevel === 'DEBUG' || normalizedLevel === 'VERBOSE' ? colors.muted : colors.text;
        const level = fg(severity)(terminalText(record.level ?? '-').padEnd(7));
        const origin = showSource ? record.source?.name ?? record.tag : record.source ? undefined : record.tag;
        line.content = new StyledText([
          fg(colors.text)(record.key === selected?.key ? '● ' : '  '),
          fg(colors.muted)(terminalText(record.timestamp.slice(11, 23)) + ' '),
          ['WARN', 'ERROR', 'FATAL'].includes(normalizedLevel) ? bold(level) : level,
          fg(colors.source)(origin ? ' ' + terminalText(origin) + ' ' : ' '),
          fg(colors.text)(terminalText(record.message.replace(/\n/g, ' ↵ '))),
        ]);
      } else line.content = i === 0 ? t(model.query ? 'noMatches' : 'waiting') : '';
    }
    logs.title = `[${fullscreen ? '↙' : '⛶'}] ${t('logStream')} · ${translate(locale, 'messageCount', { count: items.length })}`;
  }
  function paintPause() {
    pause.box.backgroundColor = model.paused && pauseHighlighted ? colors.selected : colors.background;
    pause.box.borderColor = model.paused ? colors.warn : colors.border;
    pause.text.fg = model.paused ? colors.warn : colors.text;
  }
  function updatePause() {
    if (model.paused && !pauseBlinkTimer) {
      pauseHighlighted = true;
      pauseBlinkTimer = setInterval(() => {
        if (disposed) return;
        pauseHighlighted = !pauseHighlighted;
        paintPause();
      }, 600);
    } else if (!model.paused && pauseBlinkTimer) {
      clearInterval(pauseBlinkTimer); pauseBlinkTimer = undefined; pauseHighlighted = false;
    }
    paintPause();
  }
  function refresh() {
    if (disposed) return;
    for (const label of labels) label.text.content = t(label.key);
    heading.content = terminalText(`Über Device Log${options.project ? ' · ' + options.project : ''}${options.demo !== false ? ' · ' + t('tuiDemo') : ''}`);
    consoleButton.text.content = t('consoleTitle') + (featureStatuses.javascriptConsole ? ' · ' + t(featureStatusCopy[featureStatuses.javascriptConsole].label) : '');
    sidebar.title = `[-] ${t('tuiSources')}`;
    collapsedSources.title = renderer.width >= 100 ? '[+]' : `[+] ${t('tuiSources')}`;
    sources.text.content = t(options.syncSources ? 'tuiRefreshSources' : options.demo === false ? 'tuiSources' : 'tuiDemo');
    pause.text.content = t(model.paused ? 'backToLive' : 'pause');
    updatePause();
    searchBox.title = t('literalSearch'); search.placeholder = t('searchPlaceholder');
    details.title = t('message');
    details.visible = !fullscreen && (!options.syncSources || renderer.width >= 100 || !!model.selected);
    collapse.text.content = t(sourcesCollapsed ? 'tuiShowSources' : 'tuiHideSources');
    const selected = model.selected;
    detailText.content = selected ? terminalText(JSON.stringify({ timestamp: selected.timestamp, level: selected.level, tag: selected.tag, pid: selected.pid, source: selected.source, truncated: selected.truncated }, null, 2) + '\n\n' + selected.message) : t('tuiInspectHint');
    stateLine.content = `${t(model.paused ? capturing ? 'pausedActive' : 'pausedStopped' : capturing ? 'liveCapture' : 'notCapturing')} · ${translate(locale, 'messageCount', { count: model.liveCount })}`;
    statusLine.content = terminalText(translateMessage(locale, status) || sourceName);
    help.content = t('tuiHelp');
    refreshSettings?.();
    refreshRows();
  }
  function applyTheme(node: Renderable) {
    if (node instanceof BoxRenderable) {
      node.backgroundColor = colors.background;
      if (node.border === true || (Array.isArray(node.border) && node.border.length)) { node.borderColor = colors.border; node.focusedBorderColor = colors.accent; }
    }
    const bars = node instanceof ScrollBoxRenderable ? [node.verticalScrollBar, node.horizontalScrollBar] : node instanceof ScrollBarRenderable ? [node] : [];
    for (const bar of bars) {
      bar.trackOptions = { foregroundColor: colors.muted, backgroundColor: colors.background };
      bar.arrowOptions = { foregroundColor: colors.text, backgroundColor: colors.background };
    }
    if (node instanceof TextRenderable) node.fg = colors.text;
    for (const child of node.getChildren()) applyTheme(child);
  }
  function setTheme(mode: TuiThemeMode) {
    if (disposed) return;
    themeMode = mode; colors = createTuiTheme(mode, terminalColors);
    applyTheme(root); if (modal) applyTheme(modal);
    search.textColor = colors.text; search.focusedTextColor = colors.text; search.placeholderColor = colors.muted; search.cursorColor = colors.text; search.backgroundColor = colors.panel; search.focusedBackgroundColor = colors.selected;
    heading.fg = stateLine.fg = colors.accent; statusLine.fg = help.fg = colors.muted;
    available.forEach((device, index) => {
      const node = sourceNodes[index];
      if (node instanceof BoxRenderable) node.backgroundColor = selectedSources.some(item => sourceKey(item) === sourceKey(device)) ? colors.selected : colors.panel;
    });
    refresh(); consolePanel?.update(); flowsPanel?.update();
  }
  function onPalette(value: TerminalThemeColors) {
    if (disposed) return;
    terminalColors = value;
    if (themeMode === 'auto') setTheme(themeMode);
  }
  let paletteRequest = 0;
  async function detectPalette() {
    const request = ++paletteRequest;
    try {
      const result = await renderer.getPalette({ size: 16, timeout: 700 });
      if (!disposed && request === paletteRequest) onPalette(result);
    } catch { /* Keep the readable fallback when queries are unsupported. */ }
  }
  function layout() {
    const wide = renderer.width >= 100;
    sidebar.visible = !!options.syncSources && !sourcesCollapsed && !fullscreen;
    collapsedSources.visible = !!options.syncSources && sourcesCollapsed && !fullscreen;
    collapsedSources.width = wide ? 6 : '100%';
    heading.visible = toolbar.visible = help.visible = !fullscreen;
    fullscreenBar.visible = fullscreen;
    content.flexDirection = wide ? 'row' : 'column';
    logs.width = wide ? sidebar.visible ? '45%' : '60%' : '100%';
    sidebar.width = wide ? 24 : '100%'; sidebar.height = wide ? '100%' : 6; logs.height = wide ? '100%' : '55%';
    if (options.syncSources && !wide) { logs.height = 'auto'; logs.flexBasis = 0; logs.flexShrink = 1; logs.flexGrow = 1; logs.minHeight = 3; details.height = 5; details.flexGrow = 0; }
    else { logs.flexBasis = 'auto'; logs.flexShrink = 0; logs.flexGrow = 0; details.flexGrow = 1; }
    details.width = wide ? 0 : '100%'; details.height = wide ? '100%' : options.syncSources ? 5 : 'auto'; details.flexBasis = 0;
    if (fullscreen) { content.flexDirection = 'row'; logs.width = '100%'; logs.height = '100%'; logs.flexGrow = 1; logs.flexBasis = 0; }
    refresh();
  }
  function toggleSources() {
    sourcesCollapsed = !sourcesCollapsed; layout();
    if (!sidebar.visible && (sourceNodes.includes(renderer.currentFocusedRenderable!) || renderer.currentFocusedRenderable === sources.box)) logs.focus();
  }
  function toggleFullscreen() { fullscreen = !fullscreen; layout(); logs.focus(); }
  function isVisible(node: Renderable) {
    let current: Renderable | null = node;
    while (current) { if (!current.visible) return false; current = current.parent as Renderable | null; }
    return true;
  }
  function renderSources() {
    for (const node of sourceNodes) { actions.delete(node); mainFocus = mainFocus.filter(item => item !== node); node.destroyRecursively(); }
    sourceNodes = [];
    if (options.syncSources) mainFocus = mainFocus.filter(node => node !== sources.box);
    available.forEach((device, index) => {
      const checked = selectedSources.some(item => sourceKey(item) === sourceKey(device));
      const node = new BoxRenderable(renderer, { id: `sidebar-source-${index}`, height: 3, border: true, borderColor: colors.border, focusedBorderColor: colors.accent, flexShrink: 0, focusable: true,
        backgroundColor: checked ? colors.selected : colors.panel,
        onMouseDown(event) { if (event.button !== 0) return; event.preventDefault(); node.focus(); toggleSource(device); } });
      node.add(new TextRenderable(renderer, { height: 1, selectable: false, fg: colors.text,
        content: terminalText(`${device.webview ? '  ' : ''}[${checked ? 'x' : ' '}] ${device.webview?.title || device.name}`) }));
      sidebar.add(node, index); sourceNodes.push(node); mainFocus.push(node); actions.set(node, () => toggleSource(device));
    });
    if (options.syncSources) mainFocus.push(sources.box);
  }
  function toggleSource(device: Device) {
    const key = sourceKey(device);
    const differentParent = viewParent && (viewParent.id !== device.id || viewParent.platform !== device.platform);
    viewParent = device;
    if (differentParent) { options.flows?.interrupt(); selectedSources = []; model.clear(); model.resume(); }
    const included = selectedSources.some(item => sourceKey(item) === key);
    selectedSources = included ? selectedSources.filter(item => sourceKey(item) !== key) : [...selectedSources, device];
    if (included) { options.flows?.gap(); if (!selectedSources.length) options.flows?.interrupt(); }
    model.removeSource(key);
    if (!included) {
      model.resume(); renderer.clearSelection(); offset = 0; cursor = 0;
    }
    options.syncSources?.(selectedSources);
    sourceName = selectedSources.map(item => item.webview?.title || item.name).join(' + ');
    const index = available.findIndex(item => sourceKey(item) === key);
    renderSources(); sourceNodes[index]?.focus(); refresh();
  }
  function refreshSources(): Promise<void> {
    if (disposed || !options.sources) return Promise.resolve();
    if (pendingDiscovery) return pendingDiscovery;
    clearTimeout(discoveryTimer);
    const request = ++discovery;
    pendingDiscovery = Promise.resolve().then(async () => {
      try {
        const result = await options.sources!();
        if (disposed || request !== discovery) return;
        consolePanel?.updateSources(result);
        const keys = new Set(result.map(sourceKey));
        const remaining = selectedSources.filter(device => keys.has(sourceKey(device)));
        if (remaining.length !== selectedSources.length) {
          options.flows?.gap(); if (!remaining.length) options.flows?.interrupt();
          selectedSources = remaining;
          options.syncSources?.(remaining);
          sourceName = remaining.map(item => item.webview?.title || item.name).join(' + ');
        }
        if (JSON.stringify(result) !== JSON.stringify(available)) {
          const focusedRefresh = !!options.syncSources && renderer.currentFocusedRenderable === sources.box;
          const focusedIndex = sourceNodes.indexOf(renderer.currentFocusedRenderable!);
          const focusedKey = focusedIndex < 0 ? undefined : sourceKey(available[focusedIndex]!);
          const scrollTop = sidebar.scrollTop;
          available = result; renderSources(); sidebar.scrollTo(scrollTop);
          if ((focusedKey !== undefined || focusedRefresh) && isVisible(sidebar)) {
            const next = result.findIndex(device => sourceKey(device) === focusedKey);
            const target = next >= 0 ? sourceNodes[next]! : sources.box;
            target.focus();
            sidebar.afterLayout(() => {
              if (disposed || renderer.currentFocusedRenderable !== target || !isVisible(sidebar)) return;
              if (target.y < sidebar.y + 1) sidebar.scrollBy(target.y - sidebar.y - 1);
              else if (target.y + target.height > sidebar.y + sidebar.height - 1) sidebar.scrollBy(target.y + target.height - sidebar.y - sidebar.height + 1);
            });
          }
        }
        if (!available.length) status = { code: 'noDevices' };
      } catch (error) { if (!disposed && request === discovery) status = { code: 'tuiFailure', params: { detail: String(error) } }; }
      finally {
        pendingDiscovery = undefined;
        const delay = options.sourceRefreshMs ?? 2000;
        if (!disposed && options.syncSources && delay > 0) discoveryTimer = setTimeout(() => { void refreshSources(); }, delay);
      }
      refresh();
    });
    return pendingDiscovery;
  }
  function setQuery(query: string) { model.setQuery(query); offset = 0; cursor = 0; refresh(); }
  async function save() {
    if (!options.save || saving) return;
    saving = true;
    const selected = model.selected;
    try { status = { code: 'tuiSaved', params: { path: await options.save(selected ? [selected] : model.rows(), model.order) } }; }
    catch (error) { status = { code: 'tuiFailure', params: { detail: String(error) } }; }
    finally { saving = false; refresh(); }
  }
  function openFlows() {
    if (!options.flows || flowsPanel || consolePanel || modal) return;
    root.visible = false;
    flowsPanel = createFlowsPanel(renderer, { flows: options.flows, locale: () => locale, colors: () => colors,
      close() { flowsPanel?.dispose(); flowsPanel = undefined; root.visible = true; flowsButton.box.focus(); } });
  }
  function openConsole() {
    if (!options.acquireConsole || !options.sources || consolePanel || flowsPanel || modal) return;
    root.visible = false;
    consolePanel = createConsolePanel(renderer, { acquire: options.acquireConsole, sources: options.sources,
      locale: () => locale, colors: () => colors, close() {
        consolePanel?.dispose(); consolePanel = undefined; root.visible = true; consoleButton.box.focus();
      } });
  }
  function closeModal() {
    sourceRequest++;
    settingsPicker?.close();
    if (!modal) return;
    const removed = new Set(modalFocus);
    for (const node of removed) actions.delete(node);
    for (let i = labels.length - 1; i >= 0; i--) if (removed.has(labels[i]!.text.parent as Renderable)) labels.splice(i, 1);
    refreshSettings = undefined;
    modal.destroyRecursively(); modal = undefined; modalFocus = []; modalScroller = undefined;
    restoreFocus?.focus();
  }
  function openSettings() {
    if (modal || consolePanel || flowsPanel || disposed) return;
    restoreFocus = renderer.currentFocusedRenderable;
    root.visible = false;
    modal = new BoxRenderable(renderer, { id: 'settings-dialog', width: '100%', height: '100%',
      border: true, backgroundColor: colors.background, borderColor: colors.accent, paddingX: 1,
      onMouseDown(event) {
        if (!settingsPicker && modal && event.button === 0 && event.y === modal.y && event.x >= modal.x + 2 && event.x < modal.x + 5) {
          event.preventDefault(); event.stopPropagation(); root.visible = true; closeModal();
        }
      } });
    renderer.root.add(modal);
    const close = button(modal, 'close-settings', 'settingsClose', () => { root.visible = true; closeModal(); }, modalFocus);
    close.box.maxWidth = '100%';
    const list = new ScrollBoxRenderable(renderer, { flexGrow: 1, minHeight: 1, scrollX: false, scrollY: true });
    modal.add(list); modalScroller = list;
    const updates: (() => void)[] = [];
    type Choice = { id: string; label(): string; selected(): boolean; change(): void };
    function field(id: string, title: MessageKey, choices: Choice[]) {
      const item = button(list, id, title, () => openPicker(item.box, title, choices), modalFocus);
      item.box.width = '100%'; item.box.minWidth = 0; item.box.title = t(title);
      item.text.wrapMode = 'none';
      updates.push(() => {
        item.box.title = t(title);
        item.text.content = `${choices.find(choice => choice.selected())!.label()} ▾`;
        item.text.fg = colors.text;
      });
    }
    function openPicker(trigger: BoxRenderable, title: MessageKey, choices: Choice[]) {
      if (settingsPicker || !modal) return;
      const focus: Renderable[] = [];
      const overlay = new BoxRenderable(renderer, { id: 'settings-picker-overlay', position: 'absolute', left: 0, top: 0,
        width: '100%', height: '100%', zIndex: 30,
        onMouseDown(event) { event.preventDefault(); event.stopPropagation(); if (event.button === 0) settingsPicker?.close(); } });
      modal.add(overlay);
      const popup = new BoxRenderable(renderer, { id: 'settings-picker', position: 'absolute', border: true,
        backgroundColor: colors.panel, borderColor: colors.accent,
        onMouseDown(event) { event.preventDefault(); event.stopPropagation(); } });
      overlay.add(popup);
      const pickerList = new ScrollBoxRenderable(renderer, { flexGrow: 1, minHeight: 1, scrollX: false, scrollY: true });
      popup.add(pickerList);
      const items = choices.map(choice => {
        const option = button(pickerList, choice.id, 'select', () => {
          settingsPicker?.close(); choice.change(); refresh();
        }, focus);
        option.box.height = 1; option.box.border = false; option.box.width = '100%'; option.box.minWidth = 0;
        option.text.wrapMode = 'none';
        option.box.on('focus', () => settingsPicker?.update());
        return option;
      });
      const cancel = button(popup, 'settings-picker-close', 'close', () => settingsPicker?.close(), focus);
      cancel.box.maxWidth = '100%';
      function update() {
        popup.title = t(title);
        popup.width = Math.max(1, Math.min(60, renderer.width - 4));
        popup.height = Math.max(3, Math.min(choices.length + 5, renderer.height - 2));
        popup.left = Math.max(0, Math.min(trigger.x - modal!.x, renderer.width - Number(popup.width) - 2));
        popup.top = Math.max(0, Math.min(trigger.y + trigger.height - modal!.y, renderer.height - Number(popup.height) - 2));
        popup.backgroundColor = colors.panel; popup.borderColor = colors.accent;
        items.forEach((option, index) => {
          const focused = renderer.currentFocusedRenderable === option.box;
          option.box.backgroundColor = focused ? colors.selected : colors.panel;
          option.text.fg = focused ? colors.accent : colors.text;
          option.text.content = `${choices[index]!.selected() ? '[x]' : '[ ]'} ${choices[index]!.label()}`;
        });
      }
      settingsPicker = {
        update,
        close() {
          settingsPicker = undefined;
          for (const node of focus) actions.delete(node);
          const removed = new Set(focus);
          for (let i = labels.length - 1; i >= 0; i--) if (removed.has(labels[i]!.text.parent as Renderable)) labels.splice(i, 1);
          overlay.destroyRecursively(); trigger.focus();
        },
        onKey(key) {
          key.preventDefault(); key.stopPropagation();
          if (key.name === 'escape') { settingsPicker?.close(); return; }
          const current = focus.indexOf(renderer.currentFocusedRenderable!);
          if (key.name === 'return' || key.name === 'space') { if (current >= 0) actions.get(focus[current]!)?.(); return; }
          const delta = key.name === 'up' || (key.name === 'tab' && key.shift) ? -1 : key.name === 'down' || key.name === 'tab' ? 1 : 0;
          const index = key.name === 'home' ? 0 : key.name === 'end' ? choices.length - 1 : delta ? (current + delta + focus.length) % focus.length : current;
          focus[index]?.focus();
          if (index >= 0 && index < choices.length) pickerList.scrollTo(index);
          update();
        },
      };
      update();
      const selected = Math.max(0, choices.findIndex(choice => choice.selected()));
      focus[selected]!.focus(); pickerList.scrollTo(selected);
    }
    field('settings-language', 'language', languages.map(language => ({ id: `settings-language-${language.code}`,
      label: () => language.name, selected: () => locale === language.code, change: () => { locale = language.code; } })));
    const themeKeys = { auto: 'tuiThemeAuto', light: 'tuiThemeLight', dark: 'tuiThemeDark', mono: 'tuiThemeMono' } as const;
    field('settings-theme', 'settingsAppearance', tuiThemeModes.map(mode => ({ id: `settings-theme-${mode}`,
      label: () => t(themeKeys[mode]), selected: () => themeMode === mode, change: () => setTheme(mode) })));
    field('settings-order', 'messageOrder', (['top', 'bottom'] as const).map(order => ({ id: `settings-order-${order}`,
      label: () => t(order === 'top' ? 'newestFirst' : 'oldestFirst'), selected: () => model.order === order,
      change: () => { model.setOrder(order); offset = 0; cursor = 0; renderer.clearSelection(); } })));
    const capacities = [...new Set<number>([...bufferSizes, model.capacity])].sort((a, b) => a - b);
    field('settings-capacity', 'bufferCapacity', capacities.map(capacity => ({ id: `settings-capacity-${capacity}`,
      label: () => translate(locale, 'messageCount', { count: capacity }), selected: () => model.capacity === capacity,
      change: () => { model.setCapacity(capacity); renderer.clearSelection(); } })));
    const note = new TextRenderable(renderer, { width: '100%', wrapMode: 'word', flexShrink: 0, selectable: false });
    list.add(note);
    refreshSettings = () => {
      if (!modal) return;
      modal.title = `[X] ${t('settings')}`; note.content = t('tuiSettingsSession'); note.fg = colors.muted;
      for (const update of updates) update();
      settingsPicker?.update();
    };
    refresh(); close.box.focus();
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
    if (consolePanel || flowsPanel) return;
    if (settingsPicker) { settingsPicker.onKey(key); return; }
    if (!modal && (key.name === 'f11' || (fullscreen && key.name === 'escape'))) { key.preventDefault(); toggleFullscreen(); return; }
    if (!modal && !fullscreen && key.name === 'f6' && options.syncSources) { key.preventDefault(); toggleSources(); return; }
    if (key.name === 'tab') {
      key.preventDefault(); key.stopPropagation();
      const focus = (modal ? modalFocus : mainFocus).filter(isVisible);
      let active = renderer.currentFocusedRenderable;
      while (active && !focus.includes(active)) active = active.parent as Renderable | null;
      const current = focus.indexOf(active!);
      const next = focus[(current + (key.shift ? -1 : 1) + focus.length) % focus.length];
      next?.focus();
      if (next && (sourceNodes.includes(next) || (options.syncSources && next === sources.box))) {
        if (next.y < sidebar.y + 1) sidebar.scrollBy(next.y - sidebar.y - 1);
        else if (next.y + next.height > sidebar.y + sidebar.height - 1) sidebar.scrollBy(next.y + next.height - sidebar.y - sidebar.height + 1);
      }
      if (modalScroller && next && next.id !== 'close-sources' && next.id !== 'close-settings') {
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
  if (options.syncSources) mainFocus.push(sources.box);
  renderer.keyInput.on('keypress', onKey);
  renderer.on('resize', layout);
  if (options.detectTerminalTheme !== false) { renderer.on('palette', onPalette); renderer.on('theme_mode', detectPalette); void detectPalette(); }
  layout(); setTheme(themeMode); mainFocus[0]!.focus();
  if (options.syncSources) void refreshSources();
  return {
    model, openSettings, openFlows, openConsole, get consolePanel() { return consolePanel; }, setTheme, get theme() { return colors; }, refreshSources, toggleSource, toggleSources, toggleFullscreen, controls: { sidebar, collapsedSources, collapse: collapse.box, maximize: maximize.box, search, logs, pause: pause.box, sources: sources.box, details, rows, scrollbar }, setQuery,
    ingest(messages: LogMessage[]) { if (!disposed) { options.flows?.ingest(messages); model.ingest(messages); refresh(); } },
    setStatus(value: UiMessage | string, live = capturing) { status = value; capturing = live; refresh(); },
    dispose() {
      flowsPanel?.dispose(); flowsPanel = undefined; consolePanel?.dispose(); consolePanel = undefined; disposed = true; clearInterval(pauseBlinkTimer); discovery++; clearTimeout(discoveryTimer); renderer.off('palette', onPalette); renderer.off('theme_mode', detectPalette); closeModal(); renderer.keyInput.off('keypress', onKey); renderer.off('resize', layout); root.destroyRecursively(); mainFocus = [];
    },
  };
}

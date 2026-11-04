import { BoxRenderable, TextRenderable, InputRenderable, InputRenderableEvents, ScrollBoxRenderable, type CliRenderer, type Renderable, type KeyEvent } from '@opentui/core';
import { translate, translateMessage, type Locale, type UiMessage } from '../src/i18n';
import type { MessageKey } from '../src/i18n/en';
import type { MessageParams } from '../shared/notifications';
import type { FlowSource } from '../shared/flow-types';
import type { TuiFlows } from './flows-model';
import type { createTuiTheme } from './theme';
import { browseBundleFiles, sourceDiagnostics, type BundleFileEntry } from './flow-sources';
import { terminalText } from './model';

export function createFlowSourcesPanel(renderer: CliRenderer, options: {
  flows: TuiFlows; locale(): Locale; colors(): ReturnType<typeof createTuiTheme>; close(): void;
}) {
  const manager = options.flows.sources!;
  const t = (key: MessageKey, params?: MessageParams) => translate(options.locale(), key, params);
  let disposed = false, selectedId = '', details = false, installing = false, picking = false;
  let method: 'file' | 'url' = 'file', scope: 'global' | 'project' = options.flows.snapshot?.context === 'project' ? 'project' : 'global';
  let browseEpoch = 0, fileError: UiMessage | undefined, files: BundleFileEntry[] = [];
  let rows: { box: BoxRenderable; text: TextRenderable; source: FlowSource }[] = [];
  let groups: { text: TextRenderable; scope: 'global' | 'project' }[] = [];
  let fileRows: { box: BoxRenderable; text: TextRenderable; entry: BundleFileEntry }[] = [];
  const controls: Renderable[] = [], actions = new Map<Renderable, () => void>();
  const labels = new Map<TextRenderable, () => string>();
  const root = new BoxRenderable(renderer, { id: 'flow-sources-panel', width: '100%', height: '100%', paddingX: 1 }); renderer.root.add(root);
  const heading = new TextRenderable(renderer, { height: 1, flexShrink: 0 }); root.add(heading);
  const toolbar = new BoxRenderable(renderer, { flexDirection: 'row', flexWrap: 'wrap', height: 'auto', minHeight: 3, flexShrink: 0, gap: 1 }); root.add(toolbar);
  function button(parent: BoxRenderable, id: string, label: () => string, action: () => void, enabled: () => boolean = () => true, tab = true) {
    const invoke = () => { if (enabled()) action(); };
    const box = new BoxRenderable(renderer, { id, border: true, height: 3, flexShrink: 0, minWidth: 0, maxWidth: '100%', paddingX: 1, focusable: true,
      onMouseDown(event) { if (event.button !== 0) return; event.preventDefault(); event.stopPropagation(); box.focus(); invoke(); } });
    const text = new TextRenderable(renderer, { height: 1, wrapMode: 'none', selectable: false }); box.add(text); parent.add(box);
    if (tab) controls.push(box); actions.set(box, invoke); labels.set(text, label);
    return { box, text };
  }
  const close = button(toolbar, 'sources-close', () => t(picking || details && renderer.width < 90 ? 'tuiFlowSourcesBack' : 'close'), back);
  const install = button(toolbar, 'sources-install', () => t('flowsInstallTitle'), () => { installing = true; details = false; update(); location.focus(); }, () => !manager.busy);
  const body = new BoxRenderable(renderer, { flexGrow: 1, minHeight: 3, flexDirection: 'row', gap: 1 }); root.add(body);
  const browser = new BoxRenderable(renderer, { flexGrow: 1, minWidth: 0 }); body.add(browser);
  const searchFrame = new BoxRenderable(renderer, { border: true, height: 3, flexShrink: 0 }); browser.add(searchFrame);
  const search = new InputRenderable(renderer, { id: 'sources-search', width: '100%', maxLength: 500 }); searchFrame.add(search); controls.push(search);
  const list = new ScrollBoxRenderable(renderer, { id: 'source-list', border: true, flexGrow: 1, minHeight: 3, scrollX: false, scrollY: true }); browser.add(list); controls.push(list);
  const empty = new TextRenderable(renderer, { height: 'auto', wrapMode: 'word' }); list.add(empty);
  const detail = new BoxRenderable(renderer, { id: 'source-details', flexGrow: 1, minWidth: 0 }); body.add(detail);
  const toggle = button(detail, 'source-toggle', () => selected()?.kind === 'loose' ? t('flowsSourceAlwaysLoaded') : t(selected()?.enabled ? 'flowsBundleDisable' : 'flowsBundleEnable'), () => {
    const source = selected(); if (source) void manager.toggle(source, options.flows.snapshot?.configRevision);
  }, () => { const source = selected(); return !!source && source.kind === 'bundle' && !manager.busy && (source.enabled || !source.diagnostics.length); });
  const inspector = new ScrollBoxRenderable(renderer, { id: 'source-inspector', border: true, flexGrow: 1, minHeight: 3, scrollY: true, scrollX: false }); detail.add(inspector); controls.push(inspector);
  const info = new TextRenderable(renderer, { width: '100%', wrapMode: 'word', selectable: true }); inspector.add(info);
  const form = new BoxRenderable(renderer, { id: 'bundle-form', flexGrow: 1, minHeight: 3 }); root.add(form);
  const selectors = new BoxRenderable(renderer, { flexDirection: 'row', height: 3, flexShrink: 0 }); form.add(selectors);
  button(selectors, 'bundle-method', () => t(method === 'file' ? 'flowsBundleLocalFile' : 'flowsBundleUrl'), () => { method = method === 'file' ? 'url' : 'file'; fileError = undefined; update(); location.focus(); }, () => !manager.busy);
  button(selectors, 'bundle-scope', () => t(scope === 'global' ? 'flowsScopeGlobal' : 'flowsScopeProject'), () => { if (options.flows.snapshot?.context === 'project') scope = scope === 'global' ? 'project' : 'global'; update(); }, () => !manager.busy);
  const locationFrame = new BoxRenderable(renderer, { border: true, height: 3, flexShrink: 0 }); form.add(locationFrame);
  const location = new InputRenderable(renderer, { id: 'bundle-location', width: '100%', maxLength: 4096 }); locationFrame.add(location); controls.push(location);
  const choose = button(form, 'bundle-choose', () => t('flowsBundleChooseFile'), () => { void browse(); }, () => !manager.busy);
  const formHelp = new TextRenderable(renderer, { height: 3, flexShrink: 0, wrapMode: 'word' }); form.add(formHelp);
  const submitRow = new BoxRenderable(renderer, { flexDirection: 'row', flexWrap: 'wrap', height: 'auto', minHeight: 3, flexShrink: 0 }); form.add(submitRow);
  button(submitRow, 'bundle-submit', () => t('flowsBundleInstall'), () => { fileError = undefined; void manager.install(location.value.trim(), method, scope); }, () => !manager.busy && !!location.value.trim());
  button(submitRow, 'bundle-cancel', () => t('flowsBundleCancel'), back);
  const fileList = new ScrollBoxRenderable(renderer, { id: 'bundle-files', border: true, flexGrow: 1, minHeight: 3, scrollX: false, scrollY: true }); root.add(fileList); controls.push(fileList);
  const statusBox = new ScrollBoxRenderable(renderer, { id: 'sources-status', height: 3, flexShrink: 0, scrollY: true, scrollX: false }); root.add(statusBox); controls.push(statusBox);
  const status = new TextRenderable(renderer, { width: '100%', wrapMode: 'word', selectable: true }); statusBox.add(status);
  const help = new TextRenderable(renderer, { height: 2, flexShrink: 0, wrapMode: 'word' }); root.add(help);
  function selected() { return rows.find(row => row.source.id === selectedId)?.source; }
  function visible(node: Renderable) { let parent: Renderable | null = node; while (parent) { if (!parent.visible) return false; parent = parent.parent as Renderable | null; } return true; }
  function reveal(box: Renderable, scroll: ScrollBoxRenderable) { if (box.y < scroll.y + 1) scroll.scrollBy(box.y - scroll.y - 1); else if (box.y + box.height > scroll.y + scroll.height - 1) scroll.scrollBy(box.y + box.height - scroll.y - scroll.height + 1); }
  function openSource(source: FlowSource) { selectedId = source.id; details = true; inspector.scrollTo(0); update(); if (renderer.width < 90) toggle.box.focus(); }
  function destroyRows(items: { box: BoxRenderable; text: TextRenderable }[]) { for (const item of items) { actions.delete(item.box); labels.delete(item.text); item.box.destroyRecursively(); } }
  async function browse(value = location.value) {
    const epoch = ++browseEpoch; fileError = undefined;
    try {
      const result = await browseBundleFiles(value);
      if (disposed || epoch !== browseEpoch || !installing) return;
      files = result.entries; picking = true; destroyRows(fileRows); fileRows = [];
      for (const [index, entry] of files.entries()) {
        const row = button(fileList, `bundle-file-${index}`, () => terminalText(entry.name), () => {
          if (entry.directory) { location.value = entry.path; void browse(entry.path); }
          else { location.value = entry.path; picking = false; update(); location.focus(); }
        }, () => !manager.busy, false);
        row.box.width = '100%'; fileRows.push({ ...row, entry });
      }
      fileList.title = terminalText(result.directory); fileList.scrollTo(0); update(); (fileRows[0]?.box ?? close.box).focus();
    } catch (error) { if (!disposed && epoch === browseEpoch) { fileError = { code: 'flowsBundleError', params: { detail: error instanceof Error ? error.message : String(error) } }; update(); } }
  }
  function back() {
    if (picking) { browseEpoch++; picking = false; update(); choose.box.focus(); }
    else if (installing) {
      if (manager.busy) { manager.cancel(); return; }
      browseEpoch++; installing = false; fileError = undefined; update(); install.box.focus();
    } else if (details && renderer.width < 90) { details = false; update(); (rows.find(row => row.source.id === selectedId)?.box ?? search).focus(); }
    else options.close();
  }
  search.on(InputRenderableEvents.INPUT, () => { list.scrollTo(0); update(); });
  function update() {
    if (disposed) return;
    const snapshot = options.flows.snapshot, colors = options.colors(), wide = renderer.width >= 90;
    const previouslyFocused = renderer.currentFocusedRenderable;
    const needle = search.value.trim().toLocaleLowerCase(options.locale());
    const sources = (snapshot?.sources ?? []).filter(source => !needle || [source.name, source.id, source.filename, source.description, t(source.scope === 'global' ? 'flowsScopeGlobal' : 'flowsScopeProject'), t(source.kind === 'bundle' ? 'flowsSourceBundle' : 'flowsSourceLoose')].join(' ').toLocaleLowerCase(options.locale()).includes(needle)).sort((a, b) => a.scope.localeCompare(b.scope));
    if (!sources.some(source => source.id === selectedId)) selectedId = sources.find(source => source.kind === 'bundle' && source.enabled)?.id ?? sources[0]?.id ?? '';
    if (sources.map(source => source.id).join('\n') !== rows.map(row => row.source.id).join('\n')) {
      const oldFocus = rows.find(row => row.box === previouslyFocused)?.source.id;
      destroyRows(rows); for (const group of groups) group.text.destroy(); groups = [];
      rows = sources.map((source, index) => {
        if (index === 0 || sources[index - 1]?.scope !== source.scope) { const text = new TextRenderable(renderer, { height: 1, flexShrink: 0 }); list.add(text); groups.push({ text, scope: source.scope }); }
        const row = button(list, `source-row-${index}`, () => '', () => openSource(source), undefined, false); row.box.width = '100%'; return { ...row, source };
      });
      if (oldFocus) (rows.find(row => row.source.id === oldFocus)?.box ?? search).focus();
    }
    if (!selectedId) details = false;
    rows.forEach((row, index) => { row.source = sources[index]!; actions.set(row.box, () => openSource(row.source)); });
    root.backgroundColor = colors.background; heading.fg = colors.accent; heading.content = `${t('flowsBlueprintSources')} · ${terminalText(snapshot?.projectName ?? '')}`;
    install.box.visible = !installing;
    body.visible = !installing; form.visible = installing && !picking; fileList.visible = installing && picking;
    browser.visible = wide || !details; detail.visible = !!selected() && (wide || details);
    browser.width = wide ? '42%' : '100%'; detail.width = wide ? '58%' : '100%';
    searchFrame.title = t('flowsSourceSearch'); search.placeholder = t('flowsSourceSearch');
    empty.visible = !rows.length; empty.content = t(snapshot?.sources?.length ? 'flowsSourceNoResults' : 'flowsSourceNoSources'); empty.fg = colors.muted;
    choose.box.visible = method === 'file'; locationFrame.title = t(method === 'file' ? 'flowsSourcePath' : 'flowsBundleUrl');
    formHelp.content = t(method === 'file' ? 'tuiFlowPathHelp' : 'flowsBundleHelp'); formHelp.fg = colors.muted;
    for (const input of [search, location]) { input.textColor = input.focusedTextColor = colors.text; input.backgroundColor = colors.panel; input.focusedBackgroundColor = colors.selected; input.cursorColor = colors.text; input.placeholderColor = colors.muted; }
    function theme(node: Renderable) { if (node instanceof BoxRenderable) { if (node.border === true || Array.isArray(node.border) && node.border.length) { node.borderColor = colors.border; node.focusedBorderColor = colors.accent; } node.backgroundColor = colors.background; } for (const child of node.getChildren()) theme(child); }
    theme(root);
    for (const [label, value] of labels) { label.content = value(); label.fg = colors.text; }
    for (const group of groups) { group.text.content = t(group.scope === 'global' ? 'flowsScopeGlobal' : 'flowsScopeProject'); group.text.fg = colors.muted; }
    for (const row of rows) {
      const source = row.source, attention = snapshot && (sourceDiagnostics(source, snapshot).length || source.enabled && source.activeBlueprintIds.length < source.blueprintIds.length);
      row.text.content = terminalText(`${source.id === selectedId ? '▸' : ' '} ${source.name} · ${t(source.kind === 'loose' ? 'flowsSourceAlwaysLoaded' : source.enabled ? 'flowsSourceEnabled' : 'flowsSourceDisabled')}${attention ? ' !' : ''}`);
      row.box.backgroundColor = source.id === selectedId ? colors.selected : colors.background;
    }
    const source = selected();
    if (source && snapshot) {
      inspector.title = terminalText(source.name); info.fg = colors.text;
      info.content = terminalText([
        `${t(source.scope === 'global' ? 'flowsScopeGlobal' : 'flowsScopeProject')} · ${t(source.kind === 'bundle' ? 'flowsSourceBundle' : 'flowsSourceLoose')}`,
        source.description, `${t('flowsSourcePath')}: ${source.filename}`, `${t('flowsSourceIdentifier')}: ${source.id}`,
        source.specVersion ? t('flowsSourceVersion', { version: String(source.specVersion) }) : '',
        t('flowsSourceStored', { count: source.blueprintIds.length.toLocaleString(options.locale()) }), t('flowsSourceActive', { count: source.activeBlueprintIds.length.toLocaleString(options.locale()) }),
        source.enabled && source.activeBlueprintIds.length < source.blueprintIds.length ? t('flowsSourcePartial') : '',
        ...sourceDiagnostics(source, snapshot).map(diagnostic => translateMessage(options.locale(), diagnostic)),
        t('flowsSourceInventory'), ...source.blueprintIds.map(id => { const name = snapshot.blueprints.find(item => item.id === id && item.sourceId === source.id)?.name; return `${source.activeBlueprintIds.includes(id) ? '✓' : '–'} ${name && name !== id ? name + ' · ' : ''}${id}`; }),
        !source.blueprintIds.length ? t('flowsSourceInventoryEmpty') : '',
      ].filter(Boolean).join('\n\n'));
      toggle.text.fg = source.kind === 'loose' || manager.busy || !source.enabled && !!source.diagnostics.length ? colors.muted : colors.text;
    }
    const messages = [fileError ?? manager.status, ...manager.diagnostics].filter((message): message is UiMessage => !!message);
    status.content = terminalText(messages.length ? messages.map(message => translateMessage(options.locale(), message)).join('\n') : t('flowsSourcesAutoSave')); status.fg = fileError || manager.diagnostics.length ? colors.warn : colors.muted;
    help.content = t('tuiFlowSourcesHelp'); help.fg = colors.muted;
    if (renderer.currentFocusedRenderable && !visible(renderer.currentFocusedRenderable)) (installing ? picking ? close.box : location : search).focus();
  }
  function onKey(key: KeyEvent) {
    if (key.name === 'escape') { key.preventDefault(); key.stopPropagation(); back(); return; }
    const current = renderer.currentFocusedRenderable;
    if (key.name === 'tab') {
      key.preventDefault(); key.stopPropagation(); const focus = controls.filter(visible);
      const anchor = rows.some(row => row.box === current) ? list : fileRows.some(row => row.box === current) ? fileList : current;
      const index = focus.indexOf(anchor!); focus[(index + (key.shift ? -1 : 1) + focus.length) % focus.length]?.focus(); return;
    }
    if ((key.name === 'return' || key.name === 'space') && current && actions.has(current)) { key.preventDefault(); key.stopPropagation(); actions.get(current)!(); return; }
    if (key.name === 'return' && current === location && method === 'file' && !manager.busy) { key.preventDefault(); void browse(); return; }
    const items = picking ? fileRows : rows, scroll = picking ? fileList : list;
    const index = items.findIndex(row => row.box === current);
    if (index >= 0 || current === scroll) {
      const step = key.name === 'up' ? -1 : key.name === 'down' ? 1 : key.name === 'pageup' ? -5 : key.name === 'pagedown' ? 5 : key.name === 'home' ? -items.length : key.name === 'end' ? items.length : 0;
      if (step || key.name === 'return') {
        key.preventDefault(); key.stopPropagation(); const next = items[Math.max(0, Math.min(items.length - 1, Math.max(0, index) + step))];
        if (next) { next.box.focus(); reveal(next.box, scroll); if (key.name === 'return') actions.get(next.box)?.(); } return;
      }
    }
  }
  renderer.keyInput.on('keypress', onKey); renderer.on('resize', update);
  const unsubscribe = options.flows.subscribe(update), unsubscribeManager = manager.subscribe(update);
  update(); search.focus();
  return { update, dispose() { disposed = true; browseEpoch++; manager.cancel(); unsubscribe(); unsubscribeManager(); renderer.keyInput.off('keypress', onKey); renderer.off('resize', update); root.destroyRecursively(); actions.clear(); labels.clear(); } };
}

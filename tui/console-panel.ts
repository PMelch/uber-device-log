import { BoxRenderable, TextRenderable, InputRenderable, InputRenderableEvents, ScrollBoxRenderable, type CliRenderer, type Renderable, type KeyEvent } from '@opentui/core';
import type { Device } from '../shared/types';
import type { ConsoleValue, ConsoleErrorCode } from '../shared/console';
import { translate, type Locale } from '../src/i18n';
import { featureStatuses, featureStatusCopy } from '../src/feature-status';
import { sourceKey } from './local-client';
import { terminalText } from './model';
import { createConsoleModel, type AcquireConsole, type TuiConsoleResult } from './console-model';
import type { createTuiTheme } from './theme';

type Theme = ReturnType<typeof createTuiTheme>;
export function createConsolePanel(renderer: CliRenderer, options: {
  sources(): Promise<Device[]>; acquire: AcquireConsole; locale(): Locale; colors(): Theme; close(): void;
}) {
  const t = (key: Parameters<typeof translate>[1]) => translate(options.locale(), key);
  let disposed = false, target: Device | undefined, picker: BoxRenderable | undefined;
  let pickerFocus: Renderable[] = [], outputNodes: Renderable[] = [], historyIndex = -1, draft = '';
  let choosingTargets = false, targetSignature = '';
  let targetChoices: Device[] = [];
  let focus: Renderable[] = [], outputError: ConsoleErrorCode | undefined;
  const actions = new Map<Renderable, () => void>();
  const labels = new Map<TextRenderable, () => string>();
  const previews = new WeakMap<ConsoleValue, { children: { name: string; value: ConsoleValue }[]; next?: number; expanded: boolean; loading: boolean }>();
  const model = createConsoleModel(options.acquire, () => { if (!disposed) update(); });
  function contextLabel() {
    const context = model.state.contexts.find(c => c.key === model.context);
    return context ? context.top ? t('consoleTop') : context.name || context.frame : t('consoleChoose');
  }
  const root = new BoxRenderable(renderer, { id: 'console-panel', width: '100%', height: '100%', backgroundColor: options.colors().background, paddingX: 1 });
  renderer.root.add(root);
  const body = new BoxRenderable(renderer, { width: '100%', height: '100%', flexDirection: 'column' }); root.add(body);
  const heading = new TextRenderable(renderer, { height: 1 }); body.add(heading);
  const toolbar = new BoxRenderable(renderer, { flexDirection: 'row', flexWrap: 'wrap', flexShrink: 0, minHeight: 3, height: 'auto', gap: 1 }); body.add(toolbar);
  function button(parent: BoxRenderable, id: string, label: () => string, action: () => void, list = focus) {
    const box = new BoxRenderable(renderer, { id, border: true, maxWidth: '100%', minWidth: 0, height: 3, flexShrink: 0, focusable: true, paddingX: 1,
      borderColor: options.colors().border, focusedBorderColor: options.colors().accent,
      onMouseDown(event) { if (event.button !== 0) return; event.preventDefault(); event.stopPropagation(); box.focus(); action(); } });
    const text = new TextRenderable(renderer, { content: terminalText(label()), fg: options.colors().text, height: 1, wrapMode: 'none', selectable: false });
    box.add(text); parent.add(box); list.push(box); actions.set(box, action); labels.set(text, label); return box;
  }
  button(toolbar, 'console-close', () => t('close'), options.close);
  button(toolbar, 'console-target', () => `${t('consoleTarget')}: ${target?.webview?.title || target?.webview?.id || '—'}`, () => { void chooseTarget(); });
  button(toolbar, 'console-context', () => `${t('consoleContext')}: ${contextLabel()}`, () => {
    if (model.busy || model.connecting) return;
    showPicker(t('consoleContext'), model.state.contexts.map(c => ({ label: `${c.top ? t('consoleTop') : c.name || c.frame} · ${c.url}`, action: () => model.chooseContext(c.key) })));
  });
  button(toolbar, 'console-reconnect', () => t('reconnect'), () => { if (target && !model.busy && !model.connecting) void model.connect(target); });
  button(toolbar, 'console-clear', () => t('consoleClear'), () => { outputError = undefined; model.clear(); });
  const status = new TextRenderable(renderer, { height: 2, wrapMode: 'word', flexShrink: 0 }); body.add(status);
  const output = new ScrollBoxRenderable(renderer, { id: 'console-output', flexGrow: 1, minHeight: 3, border: true, scrollX: false, scrollY: true }); body.add(output); focus.push(output);
  const inputRow = new BoxRenderable(renderer, { height: 3, flexShrink: 0, flexDirection: 'row', gap: 1 }); body.add(inputRow);
  const inputBox = new BoxRenderable(renderer, { border: true, flexGrow: 1, minWidth: 0, height: 3 }); inputRow.add(inputBox);
  const input = new InputRenderable(renderer, { id: 'console-expression', width: '100%', maxLength: 16000 }); inputBox.add(input); focus.push(input);
  input.on(InputRenderableEvents.ENTER, () => { historyIndex = -1; void model.execute(input.value); });
  button(inputRow, 'console-run', () => t(model.busy ? 'consoleRunning' : 'consoleRun'), () => { historyIndex = -1; void model.execute(input.value); });
  const help = new TextRenderable(renderer, { height: 2, flexShrink: 0, wrapMode: 'word' }); body.add(help);
  function removeNodes(nodes: Renderable[]) {
    const drop = (node: Renderable) => { actions.delete(node); if (node instanceof TextRenderable) labels.delete(node); for (const child of node.getChildren()) drop(child); };
    for (const node of nodes) { drop(node); focus = focus.filter(item => item !== node); node.destroyRecursively(); }
  }
  function closePicker() {
    if (!picker) return;
    choosingTargets = false; removeNodes([picker]); picker = undefined; pickerFocus = []; body.visible = true; input.focus();
  }
  function showPicker(title: string, items: { label: string; action(): void }[]) {
    closePicker(); body.visible = false;
    picker = new BoxRenderable(renderer, { id: 'console-picker', width: '100%', height: '100%', border: true, title, backgroundColor: options.colors().background }); root.add(picker);
    button(picker, 'console-picker-close', () => t('close'), closePicker, pickerFocus);
    const list = new ScrollBoxRenderable(renderer, { flexGrow: 1, scrollX: false, scrollY: true }); picker.add(list);
    if (!items.length) list.add(new TextRenderable(renderer, { content: t('consoleUnavailable'), fg: options.colors().muted }));
    items.forEach((item, index) => button(list, `console-choice-${index}`, () => item.label, () => { closePicker(); item.action(); }, pickerFocus));
    pickerFocus[0]?.focus();
  }
  let discovery = 0;
  async function chooseTarget() {
    if (model.busy || model.connecting) return;
    const version = ++discovery;
    showPicker(t('consoleTarget'), []);
    choosingTargets = true; targetSignature = ''; targetChoices = [];
    const opened = picker;
    try {
      const sources = (await options.sources()).filter(d => d.webview);
      if (disposed || version !== discovery || picker !== opened) return;
      updateSources(sources);
    } catch { if (!disposed && picker === opened) { closePicker(); outputError = 'consoleUnavailable'; update(); } }
  }
  function updateSources(devices: Device[]) {
    if (disposed || !picker || !choosingTargets) return;
    const sources = devices.filter(device => device.webview);
    const signature = JSON.stringify(sources);
    if (signature === targetSignature) return;
    const focused = pickerFocus.indexOf(renderer.currentFocusedRenderable!);
    const key = focused > 0 && targetChoices[focused - 1] ? sourceKey(targetChoices[focused - 1]!) : undefined;
    showPicker(t('consoleTarget'), sources.map(device => ({ label: `${device.name} · ${device.webview!.title || device.webview!.id} · ${device.webview!.url}`, action() { target = device; outputError = undefined; void model.connect(device); } })));
    choosingTargets = true; targetSignature = signature; targetChoices = sources;
    const index = key === undefined ? -1 : sources.findIndex(device => sourceKey(device) === key);
    const next = pickerFocus[index + 1]; next?.focus();
    const scroll = next?.parent instanceof ScrollBoxRenderable ? next.parent : undefined;
    // Picker controls have a fixed three-row height; layout has not run yet.
    if (next && scroll && index >= 0) scroll.scrollTo(index * 3);
  }
  async function inspect(result: TuiConsoleResult, value: ConsoleValue, more = false) {
    const preview = previews.get(value) ?? { children: [], expanded: false, loading: false };
    previews.set(value, preview);
    if (preview.loading) return;
    if (preview.expanded && !more) { preview.expanded = false; update(); return; }
    if (preview.children.length && !more) { preview.expanded = true; update(); return; }
    preview.loading = true; outputError = undefined; update();
    try {
      const page = await model.inspect(result, value, more ? preview.next : 0);
      preview.children = more ? [...preview.children, ...page.children] : page.children;
      preview.next = page.nextOffset; preview.expanded = true;
    } catch (e) { outputError = (e as { code?: ConsoleErrorCode }).code === 'consoleStale' ? 'consoleStale' : 'consoleUnavailable'; }
    finally { preview.loading = false; if (!disposed) update(); }
  }
  let newestResult: TuiConsoleResult | undefined;
  function update() {
    if (disposed) return;
    const colors = options.colors(), focused = renderer.currentFocusedRenderable?.id;
    function recolor(node: Renderable) {
      if (node instanceof BoxRenderable) {
        node.backgroundColor = colors.background;
        if (node.border === true || (Array.isArray(node.border) && node.border.length)) { node.borderColor = colors.border; node.focusedBorderColor = colors.accent; }
      }
      if (node instanceof ScrollBoxRenderable) for (const bar of [node.verticalScrollBar, node.horizontalScrollBar]) {
        bar.trackOptions = { foregroundColor: colors.muted, backgroundColor: colors.background };
        bar.arrowOptions = { foregroundColor: colors.text, backgroundColor: colors.background };
      }
      for (const child of node.getChildren()) recolor(child);
    }
    recolor(root);
    heading.content = `${t('consoleTitle')}${featureStatuses.javascriptConsole ? ' · ' + t(featureStatusCopy[featureStatuses.javascriptConsole].label) : ''}`; heading.fg = colors.accent;
    status.content = terminalText(outputError || model.error ? t(outputError ?? model.error!) : `${t(model.state.connected ? 'consoleReady' : 'consoleWaiting')} · ${target?.webview?.url || ''}`); status.fg = outputError || model.error ? colors.error : colors.muted;
    inputBox.title = t('consoleCode'); inputBox.borderColor = colors.border;
    input.textColor = input.focusedTextColor = colors.text; input.backgroundColor = colors.panel; input.focusedBackgroundColor = colors.selected; input.cursorColor = colors.text;
    help.content = t('consolePreview'); help.fg = colors.muted;
    for (const [text, label] of labels) { text.content = terminalText(label()); text.fg = colors.text; }
    removeNodes(outputNodes); outputNodes = [];
    let count = 0;
    function text(content: string, color = colors.text) {
      const node = new TextRenderable(renderer, { content: terminalText(content), fg: color, wrapMode: 'word', width: '100%', flexShrink: 0 });
      output.add(node); outputNodes.push(node);
    }
    function valueRow(result: TuiConsoleResult, value: ConsoleValue, prefix = '', depth = 0) {
      if (++count > 500) return;
      const preview = previews.get(value);
      if (value.handle && depth < 6) {
        const node = button(output, `console-value-${count}`, () => `${prefix}${preview?.expanded ? '▾' : '▸'} ${value.text}${preview?.loading ? ' · ' + t('consolePropertiesLoading') : ''}`, () => { void inspect(result, value); });
        outputNodes.push(node);
      } else text(prefix + value.text, result.exception ? colors.error : colors.text);
      if (value.truncated || (value.handle && depth >= 6)) text(t('consoleTruncated'), colors.muted);
      if (preview?.expanded) {
        preview.children.forEach(child => valueRow(result, child.value, `${'  '.repeat(depth + 1)}${child.name}: `, depth + 1));
        if (preview.next !== undefined) {
          const node = button(output, `console-more-${count}`, () => t('consoleMoreProperties'), () => { void inspect(result, value, true); }); outputNodes.push(node);
        }
      }
    }
    if (!model.results.length) text(t('consoleEmpty'), colors.muted);
    for (const result of model.results) { text('> ' + result.expression, colors.accent); if (!model.isCurrent(result)) text(t('consoleOld'), colors.muted); valueRow(result, result.value); }
    const last = model.results.at(-1);
    if (last && last !== newestResult) output.scrollTo(Infinity);
    newestResult = last;
    if (count > 500) text(t('consoleTruncated'), colors.muted);
    if (focused && !picker) focus.find(node => node.id === focused)?.focus();
  }
  function keypress(key: KeyEvent) {
    if (key.name === 'escape') { key.preventDefault(); if (picker) closePicker(); else options.close(); return; }
    const controls = picker ? pickerFocus : focus;
    if (key.name === 'tab') {
      key.preventDefault(); const current = controls.indexOf(renderer.currentFocusedRenderable!);
      const next = controls[(current + (key.shift ? -1 : 1) + controls.length) % controls.length]; next?.focus();
      const scroll = next?.parent instanceof ScrollBoxRenderable ? next.parent : undefined;
      if (scroll && next) { if (next.y < scroll.y + 1) scroll.scrollBy(next.y - scroll.y - 1); else if (next.y + next.height > scroll.y + scroll.height - 1) scroll.scrollBy(next.y + next.height - scroll.y - scroll.height + 1); }
      return;
    }
    const current = renderer.currentFocusedRenderable;
    if ((key.name === 'return' || key.name === 'space') && current && actions.has(current)) { key.preventDefault(); actions.get(current)!(); return; }
    if (!picker && current === input && (key.name === 'up' || key.name === 'down')) {
      key.preventDefault(); if (historyIndex < 0) draft = input.value;
      historyIndex = Math.max(-1, Math.min(model.history.length - 1, historyIndex + (key.name === 'up' ? 1 : -1)));
      input.value = historyIndex < 0 ? draft : model.history[historyIndex]!;
    }
  }
  renderer.keyInput.on('keypress', keypress);
  const timer = setInterval(() => model.poll(), 1000);
  update(); input.focus();
  return { model, input, root, update, updateSources, chooseTarget, dispose() { disposed = true; discovery++; clearInterval(timer); model.dispose(); renderer.keyInput.off('keypress', keypress); root.destroyRecursively(); } };
}

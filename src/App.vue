<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import { useVirtualizer, defaultRangeExtractor } from '@tanstack/vue-virtual';
import type { Device, DeviceList, LogMessage, LogSourceMetadata } from '../shared/types';
import { logLevel } from '../shared/log-view';
import { defaultSourceFilter, createSourceFilterer, mergeSourceMessages, type SourceFilter } from '../shared/log-sources';
import { createLogStreams, createLogBatcher, type StreamSource, type LogStream } from './log-streams';
import SourceFilters from './components/SourceFilters.vue';
import { rangeKeys, selectedEntries } from '../shared/log-selection';
import { serializeLogExport, type LogExportFormat } from '../shared/log-export';
import { useI18n, uiMessage, type UiMessage } from './i18n';
import UserSettings from './components/UserSettings.vue';
import { createRememberedDevice, deviceKey, webViewKey } from './remembered-device';
import { usePerformance } from './composables/usePerformance';
import { usePreferences } from './composables/usePreferences';
import PrecisionMenu from './components/PrecisionMenu.vue';
import LogMessageText from './components/LogMessageText.vue';
import LogDetails from './components/LogDetails.vue';
import { useLogDetails } from './composables/useLogDetails';

const { locale, setLocale, t, n, localizeMessage, deviceState, levelLabel } = useI18n();

const devices = ref<Device[]>([]);
const warnings = ref<(DeviceList['warnings'][number] | UiMessage)[]>([]);
const selected = ref('');
const messages = shallowRef<(LogMessage & { key: number })[]>([]);
const { bufferSize, theme, newestPosition, performanceEnabled } = usePreferences();
const { sample: performanceSample, measure: measurePerformance } = usePerformance(performanceEnabled);
const performanceNumber = (value: number) => new Intl.NumberFormat(locale.value, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value);
const pausedMessages = shallowRef<typeof messages.value>();
const paused = computed(() => pausedMessages.value !== undefined);
const visibleMessages = computed(() => pausedMessages.value ?? messages.value);
const includedKeys = ref<string[]>([]);
const sourceFilters = ref<Record<string, SourceFilter>>({});
const capturedSources = ref<Record<string, Device>>({});
const sourceStates = ref<Record<string, { live: boolean; message: UiMessage }>>({});
const capturing = computed(() => Object.values(sourceStates.value).some(state => state.live));
const filterSourceMessages = createSourceFilterer();
const filteredMessages = computed(() => measurePerformance(() => {
  const included = new Set(includedKeys.value);
  return filterSourceMessages(visibleMessages.value.filter(entry => entry.source && included.has(entry.source.key)), sourceFilters.value);
}));
const exportStatus = ref<UiMessage>();
const exportFormat = ref<LogExportFormat>('text');
const logDevice = ref<Device>();
const selectionMode = ref(false);
const selectedKeys = ref(new Set<number>());
const anchorKey = ref<number>();
const rangePending = ref(false);
const selectedRows = computed(() => selectedKeys.value.size ? selectedEntries(displayedMessages.value, selectedKeys.value) : []);
let drag: { anchor: number; base: Set<number>; x: number; y: number; pointer: number } | undefined;
let dragFrame = 0;

const copyFallback = ref<string>();
const copyText = ref<HTMLTextAreaElement>();
const copyButton = ref<HTMLButtonElement>();
const status = ref<UiMessage | string>(uiMessage('initialStatus'));
const loading = ref(false);
const following = ref(true);
const displayedMessages = computed(() => newestPosition.value === 'top'
  ? [...filteredMessages.value].reverse()
  : filteredMessages.value);
const viewport = ref<HTMLElement>();
// Keep a focused row mounted while keyboard navigation moves through the virtual list.
const focusedKey = ref<number>();
const nativeRange = shallowRef<{ start: number; end: number }>();
let nativeDragging = false;
function nativeRow(node: Node | null) {
  const element = node instanceof Element ? node : node?.parentElement;
  const row = element?.closest<HTMLElement>('[data-log-key]');
  return row && viewport.value?.contains(row) ? Number(row.dataset.logKey) : undefined;
}
function nativeSelectionChanged() {
  const selection = window.getSelection();
  const start = nativeRow(selection?.anchorNode ?? null), end = nativeRow(selection?.focusNode ?? null);
  if (start !== undefined && end !== undefined && !selection?.isCollapsed) nativeRange.value = { start, end };
  else if (!nativeDragging) nativeRange.value = undefined;
}
const rowVirtualizer = useVirtualizer<HTMLElement, HTMLElement>(computed(() => {
  const focused = focusedKey.value;
  const selection = nativeRange.value;
  return {
    count: displayedMessages.value.length,
    getScrollElement: () => viewport.value ?? null,
    estimateSize: () => 48,
    getItemKey: (index: number) => displayedMessages.value[index]!.key,
    overscan: 8,
    rangeExtractor: (range: Parameters<typeof defaultRangeExtractor>[0]) => {
      const indexes = defaultRangeExtractor(range);
      if (focused !== undefined) {
        const index = displayedMessages.value.findIndex(entry => entry.key === focused);
        if (index >= 0 && !indexes.includes(index)) indexes.push(index);
      }
      if (selection) {
        const start = displayedMessages.value.findIndex(entry => entry.key === selection.start);
        const end = displayedMessages.value.findIndex(entry => entry.key === selection.end);
        if (start >= 0 && end >= 0) {
          const included = new Set(indexes);
          for (let index = Math.min(start, end); index <= Math.max(start, end); index++) included.add(index);
          return [...included].sort((a, b) => a - b);
        }
      }
      return indexes.sort((a, b) => a - b);
    },
  };
}));
const virtualRows = computed(() => rowVirtualizer.value.getVirtualItems().map(item => ({
  item, entry: displayedMessages.value[item.index]!,
})));
const virtualHeight = computed(() => rowVirtualizer.value.getTotalSize());
watch(() => [rowVirtualizer.value.range?.startIndex, rowVirtualizer.value.range?.endIndex], () => {
  if (!nativeDragging || !nativeRange.value) return;
  const range = rowVirtualizer.value.range;
  if (!range) return;
  const start = displayedMessages.value.findIndex(entry => entry.key === nativeRange.value!.start);
  const index = start < range.startIndex ? range.endIndex : start > range.endIndex ? range.startIndex : start;
  const end = displayedMessages.value[index]?.key;
  if (end !== undefined && nativeRange.value.end !== end) nativeRange.value = { start: nativeRange.value.start, end };
});
function measureRow(element: unknown) {
  if (element instanceof HTMLElement) rowVirtualizer.value.measureElement(element);
}
function focusRow(event: FocusEvent) {
  const element = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-log-key]') : null;
  focusedKey.value = element ? Number(element.dataset.logKey) : undefined;
}
function blurRow(event: FocusEvent) {
  if (!(event.relatedTarget instanceof Node) || !viewport.value?.contains(event.relatedTarget)) focusedKey.value = undefined;
}
const details = useLogDetails(() => viewport.value?.focus({ preventScroll: true }));
const { record: detailRecord, pinned: detailPinned, position: detailPosition } = details;
const keyOf = deviceKey;
const rememberedDevice = createRememberedDevice();
const currentDevice = computed(() => devices.value.find(device => keyOf(device) === selected.value));
const sourceOptions = computed<StreamSource[]>(() => {
  const device = currentDevice.value;
  if (!device) return Object.entries(capturedSources.value).filter(([key]) => includedKeys.value.includes(key)).map(([key, device]) => ({key, device:{...device, state:'disconnected'}}));
  const options: StreamSource[] = [{ key: keyOf(device), device }, ...(device.webviews ?? []).map(webview => ({key:webViewKey(device, webview), device:{...device, webview}}))];
  for (const key of includedKeys.value) {
    if (!options.some(option => option.key === key) && capturedSources.value[key]) options.push({key, device:{...capturedSources.value[key]!, state:'disconnected'}});
  }
  return options;
});
const selectedSources = computed(() => sourceOptions.value.filter(source => includedKeys.value.includes(source.key)));
function metadata(source: StreamSource): LogSourceMetadata {
  const device = source.device;
  return { key: source.key, name: device.webview ? device.webview.title || device.webview.url || device.webview.id : device.name,
    platform: device.platform, deviceId: device.id, ...(device.webview ? {webview:device.webview} : {}) };
}
function sourceLabel(source: StreamSource) { return source.device.webview ? metadata(source).name : t('sourceDeviceLogs'); }
function entryDevice(entry: LogMessage): Device | undefined {
  return entry.source ? capturedSources.value[entry.source.key] : logDevice.value;
}
let generation = 0;
const collectors = createLogStreams({
  logs: (source, batch) => receiveLogs(source, batch),
  status: (source, message, live) => {
    sourceStates.value = {...sourceStates.value, [source.key]: {live, message}};
    const count = Object.values(sourceStates.value).filter(state => state.live).length;
    status.value = count ? uiMessage('sourcesLive', { count }) : message;
  },
}, url => new EventSource(url) as unknown as LogStream);

let poll: ReturnType<typeof setInterval>;
let nextKey = 0;
let disposed = false;
let discovery: AbortController | undefined;

async function refresh() {
  if (loading.value) return;
  loading.value = true;
  discovery = new AbortController();
  try {
    const response = await fetch('/api/devices', { signal: discovery.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result: DeviceList = await response.json();
    if (disposed) return;
    devices.value = result.devices;
    warnings.value = result.warnings;
    const restored = rememberedDevice.restoreOnce(result.devices);
    if (!selected.value && restored) { includedKeys.value = [restored]; selected.value = restored; }
    if (selected.value && currentDevice.value?.state !== 'connected') {
      stop();
      selected.value = '';
      status.value = uiMessage('disconnected');
    } else if (selected.value) {
      let changed = false;
      for (const source of selectedSources.value) {
        if (source.device.state !== 'connected' && sourceStates.value[source.key]?.message.code !== 'webviewEnded') {
          sourceStates.value[source.key] = {live:false, message:uiMessage('webviewEnded')};
          changed = true;
        }
      }
      if (changed) {
        collectors.sync(selectedSources.value.filter(source => source.device.state === 'connected'));
        const count = Object.values(sourceStates.value).filter(state => state.live).length;
        status.value = count ? uiMessage('sourcesLive', {count}) : uiMessage('webviewEnded');
      }
    }
  } catch (error) {
    if (!disposed) warnings.value = [uiMessage('discoveryFailed', { detail: error instanceof Error ? error.message : String(error) })];
  } finally {
    loading.value = false;
  }
}

function stop() {
  logBatcher.flush();
  generation++;
  collectors.close();
  sourceStates.value = Object.fromEntries(Object.entries(sourceStates.value).map(([key, state]) => [key, {...state, live:false}]));
}

function disconnect() {
  stop();
  selected.value = '';
  status.value = uiMessage('captureDisconnected');
}

function chooseSource(device: Device, key = keyOf(device)) {
  const sameDevice = selected.value === keyOf(device);
  includedKeys.value = [key];
  selected.value = keyOf(device);
  if (sameDevice) start();
}

function syncSources() {
  for (const source of selectedSources.value) {
    capturedSources.value[source.key] = {...source.device};
    sourceFilters.value[source.key] ??= defaultSourceFilter();
    sourceStates.value[source.key] ??= {live:false, message:uiMessage('connecting')};
  }
  for (const key of Object.keys(sourceStates.value)) if (!includedKeys.value.includes(key)) delete sourceStates.value[key];
  collectors.sync(selectedSources.value.filter(source => source.device.state === 'connected'));
  const count = Object.values(sourceStates.value).filter(state => state.live).length;
  status.value = !currentDevice.value ? uiMessage('captureDisconnected') : includedKeys.value.length ? (count ? uiMessage('sourcesLive', {count}) : uiMessage('connecting')) : uiMessage('noSources');
}
function toggleSource(source: StreamSource) {
  logBatcher.flush();
  const included = includedKeys.value.includes(source.key);
  includedKeys.value = included ? includedKeys.value.filter(key => key !== source.key) : [...includedKeys.value, source.key];
  if (!included) {
    // A reopened collector replays its history; replace that source's previous buffer.
    messages.value = messages.value.filter(entry => entry.source?.key !== source.key);
    sourceStates.value[source.key] = {live:false, message:uiMessage('connecting')};
  }
  syncSources();
}

function start() {
  details.close();
  stop();
  clearSelection();
  selectionMode.value = false;
  exportStatus.value = undefined;
  copyFallback.value = undefined;
  const device = currentDevice.value;
  if (!device) return;
  logDevice.value = {...device};
  messages.value = [];
  pausedMessages.value = undefined;
  capturedSources.value = {};
  sourceStates.value = {};
  following.value = true;
  status.value = uiMessage('connecting');
  syncSources();
}
const logBatcher = createLogBatcher<(LogMessage & { key: number })>(batch => { void commitLogs(batch); }, {
  capacity: () => bufferSize.value,
  compact: (rows, capacity) => measurePerformance(() => mergeSourceMessages([], rows, capacity)),
});
function receiveLogs(source: StreamSource, batch: LogMessage[]) {
  const origin = metadata(source);
  logBatcher.push(batch.map(message => ({ ...message, source: origin, key: nextKey++ })));
}
function scrollAnchor() {
  const offset = viewport.value?.scrollTop ?? 0;
  const item = rowVirtualizer.value.getVirtualItems().find(item => item.end > offset);
  return item ? { key: Number(item.key), index: item.index, offset: offset - item.start } : undefined;
}
function restoreAnchor(anchor: ReturnType<typeof scrollAnchor>) {
  if (!anchor || !viewport.value || !displayedMessages.value.length) return;
  const index = displayedMessages.value.findIndex(entry => entry.key === anchor.key);
  // If retention removed the anchor, show the nearest surviving edge.
  const target = index >= 0 ? index : newestPosition.value === 'top' ? displayedMessages.value.length - 1 : 0;
  const offset = rowVirtualizer.value.getOffsetForIndex(target, 'start');
  if (offset) rowVirtualizer.value.scrollToOffset(offset[0] + (index >= 0 ? anchor.offset : 0));
}
async function commitLogs(batch: typeof messages.value) {
  const version = generation;
  const anchor = !paused.value && !following.value ? scrollAnchor() : undefined;
  messages.value = measurePerformance(() => mergeSourceMessages(messages.value, batch, bufferSize.value));
  if (paused.value) return;
  await nextTick();
  if (disposed || paused.value || generation !== version) return;
  if (following.value) scrollToLatest();
  else restoreAnchor(anchor);
}

function onScroll() {
  const element = viewport.value;
  if (element) following.value = newestPosition.value === 'top'
    ? element.scrollTop < 50
    : element.scrollHeight - element.scrollTop - element.clientHeight < 50;
}

function scrollToLatest() {
  rowVirtualizer.value.scrollToOffset(newestPosition.value === 'top' ? 0 : virtualHeight.value, { align: newestPosition.value === 'top' ? 'start' : 'end' });
}

function follow() {
  following.value = true;
  scrollToLatest();
}

async function togglePause() {
  if (!paused.value) {
    pausedMessages.value = messages.value;
    logBatcher.flush();
    return;
  }
  logBatcher.flush();
  clearSelection();
  selectionMode.value = false;
  pausedMessages.value = undefined;
  following.value = true;
  await nextTick();
  scrollToLatest();
}

function clearView() {
  logBatcher.clear();
  details.close();
  clearSelection();
  selectionMode.value = false;
  exportStatus.value = undefined;
  copyFallback.value = undefined;
  messages.value = [];
  if (paused.value) pausedMessages.value = [];
}

watch(bufferSize, async () => {
  logBatcher.flush();
  const anchor = !following.value ? scrollAnchor() : undefined;
  messages.value = messages.value.slice(-bufferSize.value);
  if (pausedMessages.value) pausedMessages.value = pausedMessages.value.slice(-bufferSize.value);
  await nextTick();
  if (following.value) scrollToLatest(); else restoreAnchor(anchor);
});
// Dynamic row measurements can change the bottom offset after the initial render.
watch(virtualHeight, async () => {
  if (!following.value || paused.value) return;
  await nextTick();
  if (following.value && !paused.value) scrollToLatest();
});

watch(displayedMessages, rows => {
  // The virtualizer otherwise retains measurements for every key ever displayed.
  if (!rows.length) rowVirtualizer.value.measure();
  else if (rowVirtualizer.value.itemSizeCache.size > bufferSize.value * 1.25) {
    const retained = new Set(rows.map(row => row.key));
    for (const key of rowVirtualizer.value.itemSizeCache.keys()) if (!retained.has(Number(key))) rowVirtualizer.value.itemSizeCache.delete(key);
  }
  if (focusedKey.value !== undefined && !rows.some(row => row.key === focusedKey.value)) {
    focusedKey.value = undefined;
    viewport.value?.focus({ preventScroll: true });
  }
  if (selectedKeys.value.size) selectedKeys.value = new Set(selectedEntries(rows, selectedKeys.value).map(row => row.key));
  if (anchorKey.value !== undefined && !rows.some(row => row.key === anchorKey.value)) { anchorKey.value = undefined; rangePending.value = false; }
});
watch(status, () => { exportStatus.value = undefined; });
watch(selected, () => {
  rememberedDevice.remember(currentDevice.value);
  if (selected.value) start();
  else stop();
});
watch(newestPosition, async () => {
  following.value = true;
  await nextTick();
  scrollToLatest();
});
watch(sourceFilters, async () => {
  await nextTick();
  if (following.value) scrollToLatest();
}, {deep:true});
function freezeSelection() {
  // Freeze the rows the user actually clicked before queued arrivals can evict them.
  if (!paused.value) pausedMessages.value = messages.value;
  logBatcher.flush();
  selectionMode.value = true;
}
function clearSelection() {
  endDrag();
  nativeRange.value = undefined;
  selectedKeys.value = new Set();
  anchorKey.value = undefined;
  rangePending.value = false;
  copyFallback.value = undefined;
  exportStatus.value = undefined;
}
function chooseRow(key: number, additive = false, extend = false) {
  details.close();
  freezeSelection();
  copyFallback.value = undefined;
  exportStatus.value = undefined;
  if ((extend || rangePending.value) && anchorKey.value !== undefined) {
    const range = rangeKeys(displayedMessages.value, anchorKey.value, key);
    selectedKeys.value = additive ? new Set([...selectedKeys.value, ...range]) : range;
    rangePending.value = false;
  } else {
    const keys = additive ? new Set(selectedKeys.value) : new Set<number>();
    if (keys.has(key)) keys.delete(key); else keys.add(key);
    selectedKeys.value = keys;
    anchorKey.value = key;
  }
}
function selectAll() {
  details.close();
  freezeSelection();
  selectedKeys.value = new Set(displayedMessages.value.map(row => row.key));
  rangePending.value = false;
}
function rowPointerDown(event: PointerEvent, key: number) {
  if (event.button !== 0 || (event.target as HTMLElement).closest('input, button')) return;
  // Native selection in message text; row selection remains available via Select,
  // checkboxes, modifiers and dragging outside the message text.
  if (!selectionMode.value && !event.shiftKey && !event.ctrlKey && !event.metaKey && (event.target as HTMLElement).closest('.precision-msg')) {
    if (!paused.value) pausedMessages.value = messages.value;
    logBatcher.flush();
    nativeRange.value = { start: key, end: key };
    nativeDragging = true;
    return;
  }
  if (event.pointerType !== 'mouse') return;
  event.preventDefault();
  viewport.value?.focus({preventScroll:true});
  const additive = event.ctrlKey || event.metaKey;
  const base = additive ? new Set(selectedKeys.value) : new Set<number>();
  const anchor = event.shiftKey && anchorKey.value !== undefined ? anchorKey.value : key;
  const completingRange = rangePending.value;
  chooseRow(key, additive, event.shiftKey);
  if (additive || completingRange) return; // modifier-click toggles; ordinary drag selects a range
  drag = {anchor, base, x:event.clientX, y:event.clientY, pointer:event.pointerId};
  viewport.value?.setPointerCapture(event.pointerId);
  dragFrame = requestAnimationFrame(dragStep);
}
function dragStep() {
  if (!drag || !viewport.value) return;
  const bounds = viewport.value.getBoundingClientRect();
  if (drag.y < bounds.top + 28) viewport.value.scrollTop -= 14;
  else if (drag.y > bounds.bottom - 28) viewport.value.scrollTop += 14;
  const hit = document.elementFromPoint(Math.max(bounds.left+1,Math.min(bounds.right-1,drag.x)), Math.max(bounds.top+1,Math.min(bounds.bottom-1,drag.y)))?.closest<HTMLElement>('[data-log-key]');
  if (hit && viewport.value.contains(hit)) selectedKeys.value = new Set([...drag.base, ...rangeKeys(displayedMessages.value,drag.anchor,Number(hit.dataset.logKey))]);
  dragFrame = requestAnimationFrame(dragStep);
}
function moveDrag(event: PointerEvent) { if (drag) { drag.x=event.clientX; drag.y=event.clientY; } }
function endDrag() {
  nativeDragging = false;
  const pointer = drag?.pointer;
  drag = undefined;
  if (pointer !== undefined && viewport.value?.hasPointerCapture(pointer)) viewport.value.releasePointerCapture(pointer);
  cancelAnimationFrame(dragFrame);
}
async function copyLogs() {
  if (!selectedRows.value.length || !logDevice.value) return;
  const count = selectedRows.value.length;
  const { text } = serializeLogExport(selectedRows.value, logDevice.value, exportFormat.value);
  copyFallback.value = undefined;
  try {
    await navigator.clipboard.writeText(text);
    exportStatus.value = uiMessage('copied', { count });
  } catch {
    copyFallback.value = text;
    await nextTick();
    copyText.value?.focus();
    copyText.value?.select();
  }
}
function closeCopy() { copyFallback.value = undefined; copyButton.value?.focus(); }
function saveLogs() {
  if (!displayedMessages.value.length || !logDevice.value) return;
  const { text, mimeType, extension } = serializeLogExport(
    selectedRows.value.length ? selectedRows.value : displayedMessages.value, logDevice.value, exportFormat.value,
  );
  const url = URL.createObjectURL(new Blob([text + '\n'], { type: mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `uber-device-log-${logDevice.value.platform}-${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  exportStatus.value = uiMessage('downloadRequested');
}
function displayTime(timestamp: string) { return timestamp.includes('T') ? timestamp.split('T')[1]?.replace(/Z$/, '') : timestamp; }
onMounted(() => {
  document.addEventListener('selectionchange', nativeSelectionChanged);
  window.addEventListener('pointerup', endDrag);
  void refresh();
  poll = setInterval(() => void refresh(), 3000);
});
onUnmounted(() => {
  document.removeEventListener('selectionchange', nativeSelectionChanged);
  window.removeEventListener('pointerup', endDrag);
  endDrag();
  logBatcher.clear();
  disposed = true;
  discovery?.abort();
  clearInterval(poll);
  stop();
});
</script>

<template>
  <div id="precision-design" :data-platform="logDevice?.platform" :class="{ selecting: selectionMode }">
    <header class="precision-top"><div class="precision-brand"><span class="precision-brandmark" aria-hidden="true">›_</span><span>Über <span class="brand-secondary">Device Log</span></span></div><div class="precision-toptools"><span class="precision-topnote">{{ t('tagline') }}</span><UserSettings :locale="locale" :theme="theme" :order="newestPosition" @order="newestPosition = $event" :buffer-size="bufferSize" :performance="performanceEnabled" @performance="performanceEnabled = $event" @locale="setLocale" @theme="theme = $event" @buffer-size="bufferSize = $event" />
    </div></header>
    <div class="precision-workspace">
      <aside class="precision-device-sidebar" :aria-label="t('availableDevices')">
        <div class="device-sidebar-heading"><h2>{{ t('availableDevices') }}</h2><button class="precision-iconbutton" :disabled="loading" :aria-label="t('refreshDevices')" @click="refresh">↻</button></div>
        <p v-if="!devices.length" class="device-sidebar-empty">{{ t('authorizeDevice') }}</p>
        <div class="device-sidebar-list">
          <template v-for="device in devices" :key="keyOf(device)">
          <button type="button" class="device-sidebar-item" :disabled="device.state !== 'connected'" :aria-pressed="selected === keyOf(device) && includedKeys.includes(keyOf(device))" @click="chooseSource(device)">
            <span class="precision-platform" :class="'precision-' + device.platform" aria-hidden="true"></span>
            <span class="device-sidebar-label"><strong>{{ device.name }}</strong><span class="precision-sub">{{ device.platform === 'ios' ? 'iOS' : 'Android' }} · {{ device.id }}</span><span class="precision-sub">{{ deviceState(device.state) }}</span></span>
            <span class="device-sidebar-dot" :data-connected="device.state === 'connected'" aria-hidden="true"></span>
          </button>
          <button v-for="view in device.webviews" :key="webViewKey(device, view)" type="button" class="device-sidebar-item device-webview-item" :disabled="device.state !== 'connected'" :aria-pressed="includedKeys.includes(webViewKey(device, view))" :aria-label="t('webviewSelect', { title: view.title || view.url || view.id, device: device.name })" @click="chooseSource(device, webViewKey(device, view))">
            <span class="precision-platform precision-web" aria-hidden="true"></span><span class="device-sidebar-label"><span class="precision-sub">{{ t('webviewConsole') }}</span><strong>{{ view.title || view.url || view.id }}</strong><span class="precision-sub">{{ view.url }}</span></span>
          </button>
          </template>
        </div>
        <button type="button" class="precision-action precision-disconnect" :disabled="!selected" @click="disconnect">{{ t('disconnectDevice') }}</button>
      </aside>
    <main class="precision-main">
      <div class="precision-controls">
        <div class="precision-field precision-device"><label>{{ t('connectedDevice') }}</label>
          <PrecisionMenu :label="t('chooseDevice')" :disabled="!devices.length">
            <template #selected><span v-if="currentDevice" class="precision-platform" :class="'precision-' + currentDevice.platform" aria-hidden="true"></span><span class="device-label">{{ currentDevice?.webview ? t('webviewSelected', { device: currentDevice.name, title: currentDevice.webview.title || currentDevice.webview.url || currentDevice.webview.id }) : currentDevice?.name ?? (devices.length ? t('selectDevice') : t('noDevices')) }}<span class="precision-sub">{{ currentDevice ? `${currentDevice.platform === 'ios' ? 'iOS' : 'Android'} · ${currentDevice.id}` : 'Android & iOS' }}</span></span></template>
            <div class="precision-menuhead">{{ t('availableDevices') }}</div>
            <p v-if="!devices.length" class="precision-menuhead">{{ t('authorizeDevice') }}</p>
            <template v-for="device in devices" :key="keyOf(device)">
            <button :disabled="device.state !== 'connected'" :aria-pressed="selected === keyOf(device) && includedKeys.includes(keyOf(device))" @click="chooseSource(device)"><span class="precision-platform" :class="'precision-' + device.platform" aria-hidden="true"></span><span class="device-label">{{ device.name }}<span class="precision-sub">{{ device.platform === 'ios' ? 'iOS' : 'Android' }} · {{ device.id }} · {{ deviceState(device.state) }}</span></span></button>
            <button v-for="view in device.webviews" :key="webViewKey(device, view)" class="device-webview-option" :disabled="device.state !== 'connected'" :aria-pressed="includedKeys.includes(webViewKey(device, view))" :aria-label="t('webviewSelect', { title: view.title || view.url || view.id, device: device.name })" @click="chooseSource(device, webViewKey(device, view))"><span class="precision-platform precision-web" aria-hidden="true"></span><span class="device-label">{{ view.title || view.url || view.id }}<span class="precision-sub">{{ t('webviewConsole') }} · {{ view.url }}</span></span></button>
            </template>
          </PrecisionMenu>
        </div>
        <button type="button" class="precision-action precision-disconnect" :disabled="!selected" @click="disconnect">{{ t('disconnectDevice') }}</button>
        <button class="precision-iconbutton" :disabled="loading" :aria-label="t('refreshDevices')" @click="refresh">↻</button>
      </div>
      <p v-for="(warning, index) in warnings" :key="index" class="warning" role="status">{{ localizeMessage(warning) }}</p>
      <section class="precision-console" :aria-label="t('deviceMessages')">
        <section v-if="sourceOptions.length" class="precision-source-controls" :aria-label="t('includeSources')">
          <div class="precision-source-choices"><strong>{{ t('includeSources') }}</strong>
            <label v-for="source in sourceOptions" :key="source.key" class="precision-source-choice">
              <input type="checkbox" :checked="includedKeys.includes(source.key)" :disabled="source.device.state !== 'connected' && !includedKeys.includes(source.key)" :aria-label="t('includeSource', {source:sourceLabel(source)})" @change="toggleSource(source)" />
              <span class="precision-platform" :class="source.device.webview ? 'precision-web' : 'precision-' + source.device.platform" aria-hidden="true"></span>
              <span>{{ sourceLabel(source) }}</span>
            </label>
          </div>
          <p class="precision-source-hint">{{ t('combinedHint') }}</p>
          <template v-for="source in selectedSources" :key="source.key">
            <SourceFilters :source="metadata(source)" :model-value="sourceFilters[source.key] ?? defaultSourceFilter()" :t="t" :level-label="levelLabel" @update:model-value="sourceFilters[source.key] = $event" />
            <p v-if="sourceStates[source.key] && !sourceStates[source.key]!.live" class="precision-source-status" role="status">{{ sourceLabel(source) }} · {{ localizeMessage(sourceStates[source.key]!.message) }}</p>
          </template>
        </section>
        <div class="precision-consolebar"><div class="precision-caption"><strong>{{ t(includedKeys.length > 1 ? 'combinedLogs' : selectedSources[0]?.device.webview ? 'webviewConsole' : 'logStream') }}</strong><span>·</span><span>{{ t('messageCount', { count: displayedMessages.length }) }}</span><span class="precision-live" :data-active="capturing"><span class="precision-dot"></span>{{ t(paused ? (capturing ? 'pausedActive' : 'pausedStopped') : capturing ? 'liveCapture' : 'notCapturing') }}</span></div><div class="precision-actions">
          <button class="precision-action" :disabled="!currentDevice" @click="start">↻ {{ t('reconnect') }}</button>
          <button class="precision-action" :disabled="!messages.length && !visibleMessages.length" @click="clearView">{{ t('clear') }}</button>
          <button class="precision-action precision-pause" :disabled="!currentDevice && !messages.length && !paused" :aria-pressed="paused" @click="togglePause">{{ paused ? '▷' : 'Ⅱ' }} {{ t(paused ? 'backToLive' : 'pause') }}</button>
          <button class="precision-action" :disabled="!displayedMessages.length" :aria-pressed="selectionMode" @click="selectionMode ? (clearSelection(), selectionMode = false) : freezeSelection()">{{ t(selectionMode ? 'doneSelecting' : 'select') }}</button>
        </div></div>
        <div class="precision-selectionbar" @keydown.esc="event => { if (!event.defaultPrevented) clearSelection(); }">
          <span role="status">{{ selectedRows.length ? t('selectedCount', { count: selectedRows.length }) : t('noSelection') }}</span>
          <PrecisionMenu :label="t('exportFormat')">
            <template #selected>{{ t(exportFormat === 'text' ? 'plainText' : 'structuredJson') }}</template>
            <button :aria-pressed="exportFormat === 'text'" @click="exportFormat = 'text'">{{ t('plainText') }}</button>
            <button :aria-pressed="exportFormat === 'json'" @click="exportFormat = 'json'">{{ t('structuredJson') }}</button>
          </PrecisionMenu>
          <button ref="copyButton" class="precision-action" :disabled="!selectedRows.length" @click="copyLogs">{{ t('copyCount', { count: selectedRows.length }) }}</button>
          <button class="precision-action" :disabled="!displayedMessages.length" @click="saveLogs">{{ selectedRows.length ? t('saveCount', { count: selectedRows.length }) : t('saveAll') }}</button>
            <button class="precision-action" :disabled="!displayedMessages.length" @click="selectAll">{{ t('selectAll') }}</button>
            <button class="precision-action" :disabled="anchorKey === undefined" :aria-pressed="rangePending" @click="rangePending = !rangePending">{{ t(rangePending ? 'cancelRange' : 'rangeTo') }}</button>
            <button class="precision-action" :disabled="!selectedRows.length" @click="clearSelection">{{ t('clearSelection') }}</button>
          <span v-if="rangePending" class="selection-hint">{{ t('rangeHint') }}</span>
          <span v-else class="selection-hint">{{ t(selectionMode ? 'frozenHint' : 'selectionHint') }}</span>
        </div>
        <div class="precision-columns" aria-hidden="true"><span class="precision-selectcell">#</span><span>{{ t(logDevice?.platform === 'ios' ? 'received' : 'time') }}</span><span class="precision-source-heading">{{ t('sourceColumn') }}</span><span class="precision-level-heading">{{ t('level') }}</span><span class="precision-tag">{{ t('tagPid') }}</span><span>{{ t('message') }}</span></div>
        <div ref="viewport" class="logs" tabindex="0" :aria-label="t('logMessages')" @scroll="onScroll" @pointermove="moveDrag" @pointerup="endDrag" @pointercancel="endDrag" @lostpointercapture="endDrag" @keydown.esc="clearSelection" @focusin="focusRow" @focusout="blurRow">
          <div v-if="!visibleMessages.length" class="precision-empty">{{ t(paused ? 'pausedEmpty' : selected ? includedKeys.length ? 'waiting' : 'noSources' : 'connectPrompt') }}</div>
          <div v-else-if="!displayedMessages.length" class="precision-empty">{{ t('noMatches') }}</div>
          <div v-if="displayedMessages.length" class="precision-virtual-list" :style="{ height: virtualHeight + 'px' }">
          <div v-for="{ item, entry } in virtualRows" :key="entry.key" :ref="measureRow" :data-index="item.index" :style="{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${item.start}px)` }" class="entry precision-row" :data-level="logLevel(entry.level)" :data-log-key="entry.key" :class="{ 'is-selected': selectedKeys.has(entry.key) }" @pointerdown="rowPointerDown($event, entry.key)"><label class="precision-selectcell" @pointerdown.stop><input type="checkbox" :checked="selectedKeys.has(entry.key)" :aria-label="t('selectEntry', { count: entry.key + 1 })" @click.stop="chooseRow(entry.key, true, $event.shiftKey)" /><span class="precision-number">{{ n(entry.key + 1) }}</span></label><time class="precision-time" :title="entry.timestamp">{{ displayTime(entry.timestamp) }}</time><span class="precision-entry-source" :title="entry.source?.name"><span class="precision-platform" :class="entry.source?.webview ? 'precision-web' : 'precision-' + (entry.source?.platform ?? logDevice?.platform)" aria-hidden="true"></span><span>{{ entry.source?.webview ? entry.source.name : t('sourceDeviceLogs') }}</span></span><span class="precision-level">{{ logLevel(entry.level) }}</span><span class="precision-tag">{{ entry.tag }}<span class="precision-sub">{{ entry.pid }}</span></span><div class="precision-message-cell"><LogMessageText :message="entry.message" /><button type="button" class="precision-detail-trigger" :aria-label="t('detailOpen', { count: entry.key + 1 })" aria-haspopup="dialog" :aria-expanded="detailRecord?.entry.key === entry.key" :aria-controls="detailRecord?.entry.key === entry.key ? 'log-message-details' : undefined" @pointerenter="details.preview($event, entry, entryDevice(entry))" @pointermove="details.move($event, entry, entryDevice(entry))" @pointerleave="details.leave" @pointerdown.stop="details.pointerDown" @click.stop="details.toggle($event, entry, entryDevice(entry))" @focus="details.focus($event, entry, entryDevice(entry))" @blur="details.leave">ⓘ</button></div></div>
          </div>
        </div>
        <div v-if="copyFallback !== undefined" class="precision-copy-fallback"><label for="copy-text">{{ t('clipboardFallback') }}</label><textarea id="copy-text" ref="copyText" :value="copyFallback" readonly @keydown.esc="closeCopy" /><button class="precision-action" @click="closeCopy">{{ t('close') }}</button></div>
        <div class="precision-bottom"><span>{{ t('retained', { count: visibleMessages.length, capacity: bufferSize }) }}</span><button v-if="!following && !paused" class="precision-action" @click="follow">{{ t('followLatest') }}</button><span v-else>{{ paused ? t(capturing ? 'frozenActive' : 'frozenStopped') : (newestPosition === 'top' ? '↑ ' : '↓ ') + t('followingNewest') }}</span></div>
      </section>
      <section v-if="performanceEnabled" class="precision-performance" :aria-label="t('performanceTitle')">
        <h2>{{ t('performanceTitle') }}</h2>
        <p v-if="!performanceSample.windowMs">{{ t('performancePending') }}</p>
        <div v-else class="performance-metrics">
          <p>{{ t('performanceWindow', { seconds: performanceNumber(performanceSample.windowMs / 1000) }) }}</p>
          <p>{{ t('performanceProcessing', { milliseconds: performanceNumber(performanceSample.processingMs) }) }}</p>
          <p>{{ t('performanceFrames', { rate: Math.round(performanceSample.framesPerSecond ?? 0) }) }}</p>
          <p>{{ performanceSample.longTaskCount === null ? t('performanceUnavailable') : t('performanceLongTasks', { count: performanceSample.longTaskCount, milliseconds: performanceNumber(performanceSample.longTaskMs ?? 0) }) }}</p>
        </div>
        <p class="performance-hint">{{ t('performanceHint') }}</p>
      </section>
      <footer class="precision-footer"><span>{{ t('localPrivacy') }}</span><span role="status">{{ localizeMessage(exportStatus || status) }}</span></footer>
      <p class="setup-hint">{{ t('setupHint') }}</p>
    </main>
    </div>
    <LogDetails v-if="detailRecord" :record="detailRecord" :pinned="detailPinned" :position="detailPosition" :locale="locale" @close="details.close(true)" @pin="details.pinCurrent" @enter="details.keepOpen" @leave="details.leave" />
  </div>
</template>

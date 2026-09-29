<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import type { Device, DeviceList, LogMessage } from '../shared/types';
import { createLogSearch } from '../shared/search';
import { filterLogLevels, logExportText, logLevel, logLevels, type LogLevel } from '../shared/log-view';
import PrecisionMenu from './components/PrecisionMenu.vue';
import LogMessageText from './components/LogMessageText.vue';

const devices = ref<Device[]>([]);
const warnings = ref<string[]>([]);
const selected = ref('');
const messages = ref<(LogMessage & { key: number })[]>([]);
const bufferSizes = [1000, 2000, 10000, 50000, 100000];
const bufferSize = ref(2000);
const pausedMessages = ref<typeof messages.value>();
const paused = computed(() => pausedMessages.value !== undefined);
const visibleMessages = computed(() => pausedMessages.value ?? messages.value);
const filter = ref('');
const search = computed(() => createLogSearch(visibleMessages.value));
const selectedLevels = ref<LogLevel[]>([...logLevels]);
const filteredMessages = computed(() => filterLogLevels(filter.value.trim() ? search.value(filter.value) : visibleMessages.value, currentDevice.value?.platform, selectedLevels.value));
const capturing = ref(false);
const exportStatus = ref('');
const selectedLogText = ref('');
const copyFallback = ref<string>();
const copyText = ref<HTMLTextAreaElement>();
const copyButton = ref<HTMLButtonElement>();
const status = ref('Select a device to start reading logs.');
const loading = ref(false);
const following = ref(true);
const newestPosition = ref<'top' | 'bottom'>('top');
const displayedMessages = computed(() => newestPosition.value === 'top'
  ? [...filteredMessages.value].reverse()
  : filteredMessages.value);
const viewport = ref<HTMLElement>();
const keyOf = (device: Device) => `${device.platform}:${device.id}`;
const currentDevice = computed(() => devices.value.find(d => keyOf(d) === selected.value));
let source: EventSource | undefined;
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
    if (!response.ok) throw new Error(`Device discovery failed (${response.status})`);
    const result: DeviceList = await response.json();
    if (disposed) return;
    devices.value = result.devices;
    warnings.value = result.warnings;
    if (selected.value && !currentDevice.value) {
      stop();
      selected.value = '';
      status.value = 'Selected device disconnected. Reconnect it and select it again.';
    }
  } catch (error) {
    if (!disposed) warnings.value = [error instanceof Error ? error.message : String(error)];
  } finally {
    loading.value = false;
  }
}

function stop() {
  capturing.value = false;
  source?.close();
  source = undefined;
}

function start() {
  stop();
  exportStatus.value = '';
  copyFallback.value = undefined;
  const device = currentDevice.value;
  if (!device) return;
  messages.value = [];
  pausedMessages.value = undefined;
  following.value = true;
  status.value = 'Connecting…';
  const query = new URLSearchParams({ platform: device.platform, id: device.id });
  const stream = new EventSource(`/api/logs?${query}`);
  source = stream;
  stream.addEventListener('logs', async event => {
    if (source !== stream) return;
    const batch: LogMessage[] = JSON.parse(event.data);
    const element = viewport.value;
    const anchor = !paused.value && !following.value && element
      ? Array.from(element.querySelectorAll<HTMLElement>('.entry')).find(entry => entry.getBoundingClientRect().bottom > element.getBoundingClientRect().top)
      : undefined;
    const anchorTop = anchor?.getBoundingClientRect().top;
    messages.value.push(...batch.map(message => ({ ...message, key: nextKey++ })));
    trimBuffer(messages.value);
    if (paused.value) return;
    await nextTick();
    if (paused.value || source !== stream) return;
    if (following.value) scrollToLatest();
    else if (element && anchor?.isConnected && anchorTop !== undefined) {
      element.scrollTop += anchor.getBoundingClientRect().top - anchorTop;
    }
  });
  stream.addEventListener('status', event => {
    if (source === stream) {
      status.value = JSON.parse(event.data).message;
      capturing.value = true;
    }
  });
  stream.addEventListener('stopped', event => {
    if (source !== stream) return;
    status.value = JSON.parse(event.data).message;
    stop();
  });
  stream.onerror = () => {
    if (source !== stream) return;
    status.value = 'Log connection lost. Use Reconnect to try again.';
    stop();
  };
}

function onScroll() {
  const element = viewport.value;
  if (element) following.value = newestPosition.value === 'top'
    ? element.scrollTop < 50
    : element.scrollHeight - element.scrollTop - element.clientHeight < 50;
}

function scrollToLatest() {
  if (viewport.value) viewport.value.scrollTop = newestPosition.value === 'top' ? 0 : viewport.value.scrollHeight;
}

function follow() {
  following.value = true;
  scrollToLatest();
}

async function togglePause() {
  if (!paused.value) {
    pausedMessages.value = [...messages.value];
    return;
  }
  pausedMessages.value = undefined;
  following.value = true;
  await nextTick();
  scrollToLatest();
}

function clearView() {
  exportStatus.value = '';
  copyFallback.value = undefined;
  messages.value = [];
  if (paused.value) pausedMessages.value = [];
}

function trimBuffer(buffer: typeof messages.value) {
  if (buffer.length > bufferSize.value) buffer.splice(0, buffer.length - bufferSize.value);
}

watch(bufferSize, async () => {
  trimBuffer(messages.value);
  if (pausedMessages.value) trimBuffer(pausedMessages.value);
  await nextTick();
  if (following.value) scrollToLatest();
});

watch(displayedMessages, async () => { await nextTick(); updateLogSelection(); });
watch(status, () => { exportStatus.value = ''; });
watch(selected, start);
watch(newestPosition, async () => {
  following.value = true;
  await nextTick();
  scrollToLatest();
});
watch([filter, selectedLevels], async () => {
  await nextTick();
  if (following.value) scrollToLatest();
});
function toggleLevel(level: LogLevel) {
  selectedLevels.value = selectedLevels.value.includes(level)
    ? selectedLevels.value.filter(value => value !== level) : [...selectedLevels.value, level];
}
function updateLogSelection() {
  const selection = window.getSelection();
  const inside = selection && !selection.isCollapsed && selection.anchorNode && selection.focusNode
    && viewport.value?.contains(selection.anchorNode) && viewport.value?.contains(selection.focusNode);
  selectedLogText.value = inside ? selection.toString() : '';
}
async function copyLogs() {
  const text = selectedLogText.value;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    exportStatus.value = 'Selected log text copied.';
  } catch {
    copyFallback.value = text;
    await nextTick();
    copyText.value?.focus();
    copyText.value?.select();
  }
}
function closeCopy() { copyFallback.value = undefined; copyButton.value?.focus(); }
function saveLogs() {
  if (!displayedMessages.value.length) return;
  const text = logExportText(displayedMessages.value, selectedLogText.value);
  const url = URL.createObjectURL(new Blob([text + '\n'], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `uber-device-log-${currentDevice.value?.platform ?? 'device'}-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  exportStatus.value = 'Log download requested.';
}
function displayTime(timestamp: string) { return timestamp.includes('T') ? timestamp.split('T')[1]?.replace(/Z$/, '') : timestamp; }
onMounted(() => {
  document.addEventListener('selectionchange', updateLogSelection);
  void refresh();
  poll = setInterval(() => void refresh(), 3000);
});
onUnmounted(() => {
  document.removeEventListener('selectionchange', updateLogSelection);
  disposed = true;
  discovery?.abort();
  clearInterval(poll);
  stop();
});
</script>

<template>
  <div id="precision-design" :data-platform="currentDevice?.platform">
    <header class="precision-top"><div class="precision-brand"><span class="precision-brandmark" aria-hidden="true">›_</span><span>Über <span class="brand-secondary">Device Log</span></span></div><span class="precision-topnote">Android &amp; iOS logs, in one place.</span></header>
    <main class="precision-main">
      <div class="precision-controls">
        <div class="precision-field precision-device"><label>Connected device</label>
          <PrecisionMenu label="Choose connected device" :disabled="!devices.length">
            <template #selected><span v-if="currentDevice" class="precision-platform" :class="'precision-' + currentDevice.platform" aria-hidden="true"></span><span class="device-label">{{ currentDevice?.name ?? (devices.length ? 'Select a device' : 'No connected devices') }}<span class="precision-sub">{{ currentDevice ? `${currentDevice.platform === 'ios' ? 'iOS' : 'Android'} · ${currentDevice.id}` : 'Android & iOS' }}</span></span></template>
            <div class="precision-menuhead">Available devices</div>
            <p v-if="!devices.length" class="precision-menuhead">Connect and authorize a device.</p>
            <button v-for="device in devices" :key="keyOf(device)" :disabled="device.state !== 'connected'" :aria-pressed="selected === keyOf(device)" @click="selected = keyOf(device)"><span class="precision-platform" :class="'precision-' + device.platform" aria-hidden="true"></span><span class="device-label">{{ device.name }}<span class="precision-sub">{{ device.platform === 'ios' ? 'iOS' : 'Android' }} · {{ device.id }} · {{ device.state }}</span></span></button>
          </PrecisionMenu>
        </div>
        <button class="precision-iconbutton" :disabled="loading" aria-label="Refresh devices" @click="refresh">↻</button>
        <div class="precision-field"><label>Message order</label><PrecisionMenu label="Message order"><template #selected>↕ {{ newestPosition === 'top' ? 'Newest first' : 'Oldest first' }}</template><button :aria-pressed="newestPosition === 'top'" @click="newestPosition = 'top'">Newest first</button><button :aria-pressed="newestPosition === 'bottom'" @click="newestPosition = 'bottom'">Oldest first</button></PrecisionMenu></div>
        <div class="precision-field"><label>Buffer capacity</label><PrecisionMenu label="Buffer capacity"><template #selected>{{ bufferSize.toLocaleString() }}</template><button v-for="size in bufferSizes" :key="size" :aria-pressed="bufferSize === size" @click="bufferSize = size">{{ size.toLocaleString() }} messages</button></PrecisionMenu></div>
      </div>
      <p v-for="warning in warnings" :key="warning" class="warning" role="status">{{ warning }}</p>
      <section class="precision-console" aria-label="Device messages">
        <div class="precision-searchbar" role="search"><span aria-hidden="true">⌕</span><input v-model="filter" type="search" aria-label="Filter logs" placeholder="Find a message, tag, or process…" @keydown.esc="filter = ''" /><span class="precision-fuzzy">FUZZY SEARCH</span><button v-if="filter" class="precision-searchclear" @click="filter = ''">Clear filter</button></div>
        <div class="precision-consolebar"><div class="precision-caption"><strong>Log stream</strong><span>·</span><span>{{ displayedMessages.length.toLocaleString() }} messages</span><span class="precision-live" :data-active="capturing"><span class="precision-dot"></span>{{ paused ? 'View paused · capture ' + (capturing ? 'active' : 'stopped') : capturing ? 'Live capture' : 'Not capturing' }}</span></div><div class="precision-actions">
          <button class="precision-action" :disabled="!currentDevice" @click="start">↻ Reconnect</button>
          <button class="precision-action" :disabled="!messages.length && !visibleMessages.length" @click="clearView">Clear</button>
          <button class="precision-action precision-pause" :disabled="!currentDevice && !messages.length && !paused" :aria-pressed="paused" @click="togglePause">{{ paused ? '▷ Resume' : 'Ⅱ Pause' }}</button>
          <div class="precision-export-actions" role="group" aria-label="Export selected text or displayed log"><button ref="copyButton" class="precision-action" :disabled="!selectedLogText" title="Copy selected log text" @pointerdown.prevent @click="copyLogs">Copy</button><button class="precision-action" :disabled="!displayedMessages.length" :title="selectedLogText ? 'Save selected log text' : 'Save all displayed log messages'" @pointerdown.prevent @click="saveLogs">↓ Save</button></div>
        </div></div>
        <div class="precision-severitybar" role="group" aria-label="Android severity filters" :aria-describedby="currentDevice?.platform === 'ios' ? 'ios-note' : undefined"><span class="precision-severitylabel">Levels</span><button class="precision-severity" :disabled="currentDevice?.platform !== 'android'" :aria-pressed="currentDevice?.platform === 'android' && selectedLevels.length === logLevels.length" @click="selectedLevels = [...logLevels]">All</button><button v-for="level in logLevels" :key="level" class="precision-severity" :data-severity="level" :disabled="currentDevice?.platform !== 'android'" :aria-pressed="currentDevice?.platform === 'android' && selectedLevels.includes(level)" @click="toggleLevel(level)"><span class="precision-check">✓</span>{{ level }}</button><span v-if="currentDevice?.platform === 'ios'" id="ios-note" class="precision-ios-note">Level filters are available for Android. For this iOS stream, search the original log text.</span></div>
        <div class="precision-columns" aria-hidden="true"><span class="precision-number">#</span><span>{{ currentDevice?.platform === 'ios' ? 'Received' : 'Time' }}</span><span class="precision-level-heading">Level</span><span class="precision-tag">Tag / PID</span><span>Message</span></div>
        <div ref="viewport" class="logs" tabindex="0" aria-label="Device log messages" @scroll="onScroll">
          <div v-if="!visibleMessages.length" class="precision-empty">{{ paused ? 'View paused. Resume to show incoming messages.' : selected ? 'Waiting for messages…' : 'Connect a device, then choose it above.' }}</div>
          <div v-else-if="!displayedMessages.length" class="precision-empty">No messages match these filters.</div>
          <div v-for="entry in displayedMessages" :key="entry.key" class="entry precision-row" :data-level="logLevel(entry.level)"><span class="precision-number">{{ entry.key + 1 }}</span><time class="precision-time" :title="entry.timestamp">{{ displayTime(entry.timestamp) }}</time><span class="precision-level">{{ logLevel(entry.level) }}</span><span class="precision-tag">{{ entry.tag }}<span class="precision-sub">{{ entry.pid }}</span></span><LogMessageText :message="entry.message" /></div>
        </div>
        <div v-if="copyFallback !== undefined" class="precision-copy-fallback"><label for="copy-text">Clipboard unavailable. Copy the selected text manually.</label><textarea id="copy-text" ref="copyText" :value="copyFallback" readonly @keydown.esc="closeCopy" /><button class="precision-action" @click="closeCopy">Close</button></div>
        <div class="precision-bottom"><span>{{ visibleMessages.length.toLocaleString() }} of {{ bufferSize.toLocaleString() }} retained</span><button v-if="!following && !paused" class="precision-action" @click="follow">Follow latest</button><span v-else>{{ paused ? 'View frozen · capture ' + (capturing ? 'continues' : 'stopped') : (newestPosition === 'top' ? '↑' : '↓') + ' Following newest messages' }}</span></div>
      </section>
      <footer class="precision-footer"><span>On your machine. Logs stay local.</span><span role="status">{{ exportStatus || status }}</span></footer>
      <p class="setup-hint">Android: enable USB debugging and authorize this computer. iOS: unlock and trust this computer. iOS timestamps are receipt times.</p>
    </main>
  </div>
</template>

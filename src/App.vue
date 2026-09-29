<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import type { Device, DeviceList, LogMessage } from '../shared/types';
import { createLogSearch } from '../shared/search';

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
const filteredMessages = computed(() => filter.value.trim() ? search.value(filter.value) : visibleMessages.value);
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
  source?.close();
  source = undefined;
}

function start() {
  stop();
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
    if (source === stream) status.value = JSON.parse(event.data).message;
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

watch(selected, start);
watch(newestPosition, async () => {
  following.value = true;
  await nextTick();
  scrollToLatest();
});
watch(filter, async () => {
  await nextTick();
  if (following.value) scrollToLatest();
});
onMounted(() => {
  void refresh();
  poll = setInterval(() => void refresh(), 3000);
});
onUnmounted(() => {
  disposed = true;
  discovery?.abort();
  clearInterval(poll);
  stop();
});
</script>

<template>
  <main>
    <h1>Device logs</h1>
    <div class="toolbar">
      <label for="device">Device</label>
      <select id="device" v-model="selected">
        <option value="">{{ devices.length ? 'Select an Android or iOS device' : 'No connected devices' }}</option>
        <option v-for="device in devices" :key="keyOf(device)" :value="keyOf(device)" :disabled="device.state !== 'connected'">
          {{ device.platform === 'ios' ? 'iOS' : 'Android' }} · {{ device.name }} · {{ device.id }}{{ device.state !== 'connected' ? ` (${device.state})` : '' }}
        </option>
      </select>
      <button :disabled="loading" @click="refresh">Refresh</button>
      <button :disabled="!currentDevice" @click="start">Reconnect</button>
      <button :disabled="!currentDevice && !messages.length && !paused" :aria-pressed="paused" @click="togglePause">{{ paused ? 'Resume' : 'Pause' }}</button>
      <button :disabled="!messages.length && !visibleMessages.length" @click="clearView">Clear view</button>
      <label for="newest-position">Newest messages</label>
      <select id="newest-position" v-model="newestPosition">
        <option value="top">On top</option>
        <option value="bottom">On bottom</option>
      </select>
      <label for="buffer-size">Buffer size</label>
      <select id="buffer-size" v-model.number="bufferSize">
        <option v-for="size in bufferSizes" :key="size" :value="size">{{ size.toLocaleString() }} messages</option>
      </select>
    </div>
    <div class="filter-bar" role="search">
      <label for="log-filter">Filter logs</label>
      <input id="log-filter" v-model="filter" type="search" placeholder="Search all log text…" aria-describedby="filter-help" @keydown.esc="filter = ''" />
      <button :disabled="!filter" @click="filter = ''">Clear filter</button>
    </div>
    <p id="filter-help" class="hint">Fuzzy, case-insensitive search. All search terms must match anywhere in a message or its metadata.</p>
    <p v-for="warning in warnings" :key="warning" class="warning">{{ warning }}</p>
    <div class="summary">
      <span role="status">{{ status }}{{ paused ? ' · View paused.' : '' }}</span>
      <button v-if="!following && !paused" @click="follow">Follow latest</button>
      <span>{{ filter.trim() ? `${filteredMessages.length.toLocaleString()} matching · ` : '' }}{{ visibleMessages.length.toLocaleString() }} / {{ bufferSize.toLocaleString() }} messages</span>
    </div>
    <div ref="viewport" class="logs" tabindex="0" aria-label="Device log messages" @scroll="onScroll">
      <p v-if="!visibleMessages.length" class="empty">{{ paused ? 'View paused. Resume to show incoming messages.' : selected ? 'Waiting for messages…' : 'Connect a device, then choose it above.' }}</p>
      <p v-else-if="!displayedMessages.length" class="empty">No messages match this filter.</p>
      <div v-for="entry in displayedMessages" :key="entry.key" class="entry">
        <time>{{ entry.timestamp }}</time>
        <span class="message"><strong v-if="entry.level || entry.tag">{{ [entry.level, entry.tag, entry.pid].filter(value => value !== undefined).join(' ') }} </strong>{{ entry.message }}</span>
      </div>
    </div>
    <p class="hint">Android: enable USB debugging and authorize this computer. iOS: unlock the device and trust this computer. iOS timestamps below are receipt times; original log text is preserved.</p>
  </main>
</template>

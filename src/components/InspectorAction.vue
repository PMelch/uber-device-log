<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref } from 'vue';
import type { LogSourceMetadata } from '../../shared/types';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../../shared/notifications';
const props = defineProps<{ source: LogSourceMetadata; t: (key: MessageKey, params?: MessageParams) => string; compact?: boolean; deviceName?: string }>();
const trigger = ref<HTMLButtonElement>(), panel = ref<HTMLDialogElement>();
const busy = ref(false), visible = ref(false), error = ref<MessageKey>(), address = ref(''), copied = ref(false), copyFailed = ref(false);
let disposed = false;
const android = computed(() => props.source.platform === 'android');
const title = computed(() => props.t(android.value ? 'inspectorChrome' : 'inspectorSafari'));
const details = computed(() => [props.deviceName || props.source.name, props.source.deviceId, props.source.webview?.socket, props.source.webview?.title, props.source.webview?.url].filter(Boolean).join('\n'));
async function show() { visible.value = true; await nextTick(); if (!disposed) panel.value?.showModal(); }
function close() { panel.value?.close(); visible.value = false; trigger.value?.focus({ preventScroll: true }); }
async function open() {
  error.value = undefined; address.value = ''; copied.value = false; copyFailed.value = false;
  if (!android.value) { await show(); return; }
  const target = props.source.webview;
  if (!target || busy.value) return;
  // Reserve the tab during the click, before the asynchronous bridge request.
  const tab = window.open('about:blank', '_blank');
  if (tab) tab.opener = null;
  busy.value = true;
  try {
    const response = await fetch('/api/inspector', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ platform: props.source.platform, id: props.source.deviceId, socket: target.socket, target: target.id }) });
    const result = await response.json();
    if (!response.ok) throw ['inspectorInvalid', 'inspectorBusy', 'inspectorUnavailable'].includes(result.code) ? result.code : 'inspectorUnavailable';
    if (typeof result.url !== 'string') throw 'inspectorUnavailable';
    const url = new URL(result.url);
    if (url.protocol !== 'https:' || url.hostname !== 'chrome-devtools-frontend.appspot.com') throw new Error('inspectorUnavailable');
    if (disposed) { tab?.close(); return; }
    address.value = url.href;
    if (tab && !tab.closed) tab.location.replace(address.value);
    else error.value = 'inspectorBlocked';
    await show();
  } catch (reason) {
    tab?.close();
    if (!disposed) { error.value = ['inspectorInvalid', 'inspectorBusy', 'inspectorUnavailable'].includes(String(reason)) ? reason as MessageKey : 'inspectorUnavailable'; await show(); }
  } finally { busy.value = false; }
}
async function copy() {
  try { await navigator.clipboard.writeText(address.value || details.value); copied.value = true; copyFailed.value = false; }
  catch { copied.value = false; copyFailed.value = true; }
}
onUnmounted(() => { disposed = true; });
</script>
<template>
  <button ref="trigger" type="button" class="inspector-trigger" :class="{ compact }" :disabled="busy" :title="title" :aria-label="busy ? t('inspectorOpening') : undefined" :aria-description="title" :aria-busy="busy" aria-haspopup="dialog" :aria-expanded="visible" @click="open"><svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="2.5" y="4" width="15" height="12" rx="2"/><path d="M3 7.5h14M11 10l2 2-2 2M8 10l-2 2 2 2"/></svg><span>{{ t('inspectorAction') }}</span></button>
  <Teleport to="body">
    <dialog v-if="visible" ref="panel" class="inspector-dialog" :aria-label="title" @cancel.prevent.stop="close">
      <header><strong>{{ title }}</strong><button type="button" :aria-label="t('close')" @click="close">×</button></header>
      <main>
        <p v-if="error" role="alert" class="inspector-message">{{ t(error) }}</p>
        <template v-if="!android"><ol><li>{{ t('inspectorSafariSetup') }}</li><li>{{ t('inspectorSafariSelect') }}</li></ol></template>
        <template v-else-if="address"><p>{{ t('inspectorAddressHint') }}</p><p class="inspector-setup">{{ t('inspectorChromeSetup') }}</p></template>
        <label>{{ t('inspectorTarget') }}<textarea readonly :value="address || details" :aria-label="t('inspectorTarget')" spellcheck="false" @focus="($event.target as HTMLTextAreaElement).select()" /></label>
        <p v-if="copyFailed" role="status">{{ t('inspectorCopyFailed') }}</p>
      </main>
      <footer><button type="button" class="inspector-copy" @click="copy">{{ t(copied ? 'copiedAction' : address ? 'inspectorCopyAddress' : 'inspectorCopyDetails') }}</button></footer>
    </dialog>
  </Teleport>
</template>
<style scoped>
.inspector-trigger, #precision-design .inspector-trigger { display:inline-flex; align-items:center; justify-content:center; gap:6px; flex-shrink:0; height:36px; box-sizing:border-box; white-space:nowrap; padding:0 10px; color:var(--pl-accent,#2466df); background:var(--pl-panel,#fff); border:1px solid var(--pl-line,#e2e4ea); border-radius:7px; font:500 12px/1.3 system-ui,sans-serif; cursor:pointer; }
.inspector-trigger.compact { min-width:36px; padding:0 7px; }.inspector-trigger:disabled { opacity:.55; cursor:wait; }.inspector-trigger:hover, #precision-design .inspector-trigger:hover { background:color-mix(in srgb,var(--pl-accent,#2466df) 8%,var(--pl-panel,#fff)); }
.inspector-trigger:focus-visible,.inspector-dialog button:focus-visible,.inspector-dialog textarea:focus-visible { outline:2px solid var(--pl-accent,#2466df); outline-offset:2px; }
.inspector-dialog { --pl-panel:#fff; --pl-text:#24252c; --pl-soft:#737782; --pl-line:#e2e4ea; --pl-accent:#2466df; width:min(460px,calc(100vw - 24px)); max-height:calc(100dvh - 24px); padding:0; border:1px solid var(--pl-line); border-radius:14px; color:var(--pl-text); background:var(--pl-panel); box-shadow:0 20px 65px #13213f35; font:13px/1.6 system-ui,sans-serif; }
.inspector-dialog::backdrop { background:#1b233a45; }.inspector-dialog header { display:flex; justify-content:space-between; align-items:center; gap:12px; padding:14px 18px; border-bottom:1px solid var(--pl-line); }.inspector-dialog header button { font-size:22px; width:32px; height:32px; }.inspector-dialog button { border:0; border-radius:7px; background:transparent; color:inherit; cursor:pointer; }.inspector-dialog main { padding:4px 18px 16px; }.inspector-dialog ol { padding-left:20px; }.inspector-dialog li { padding-left:4px; margin:12px 0; }.inspector-dialog label { display:block; color:var(--pl-soft); font-size:11px; font-weight:600; }.inspector-dialog textarea { display:block; box-sizing:border-box; width:100%; height:108px; margin-top:6px; resize:vertical; padding:10px; border:1px solid var(--pl-line); border-radius:8px; background:color-mix(in srgb,var(--pl-text) 3%,var(--pl-panel)); color:var(--pl-text); font:12px/1.6 monospace; overflow-wrap:anywhere; }.inspector-setup { color:var(--pl-soft); font-size:12px; }.inspector-message { color:var(--pl-text); }.inspector-dialog footer { display:flex; justify-content:flex-end; border-top:1px solid var(--pl-line); padding:12px 18px; }.inspector-dialog .inspector-copy { padding:9px 12px; background:var(--pl-accent); color:var(--pl-panel); font:600 12px system-ui,sans-serif; }
:global(:root[data-theme=dark] .inspector-dialog) { --pl-panel:#1c1e24; --pl-text:#eceef3; --pl-soft:#a2a7b6; --pl-line:#383c48; --pl-accent:#8cb5ff; }
@media(max-width:600px) { .inspector-dialog { margin:auto auto 12px; }.inspector-dialog textarea { font-size:16px; } }
</style>

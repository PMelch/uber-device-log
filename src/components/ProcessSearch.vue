<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, useId, watch } from 'vue';
import type { AndroidProcess } from '../../shared/types';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../../shared/notifications';
const props = defineProps<{ deviceId: string; deviceName?: string; t: (key: MessageKey, params?: MessageParams) => string }>();
const emit = defineEmits<{ select: [pid: string] }>();
const trigger = ref<HTMLButtonElement>(), panel = ref<HTMLDialogElement>(), search = ref<HTMLInputElement>();
const visible = ref(false), busy = ref(false), failed = ref(false), query = ref('');
const processes = ref<AndroidProcess[]>([]);
const id = useId();
const results = ref<HTMLElement>();
watch(query, () => { if (results.value) results.value.scrollTop = 0; });
let request: AbortController | undefined;
const matches = computed(() => {
  const term = query.value.trim().toLowerCase();
  return processes.value.filter(process => process.name.toLowerCase().includes(term) || String(process.pid).includes(term));
});
async function refresh() {
  request?.abort();
  const current = request = new AbortController();
  busy.value = true; failed.value = false; processes.value = [];
  if (results.value) results.value.scrollTop = 0;
  try {
    const response = await fetch(`/api/processes?${new URLSearchParams({ id: props.deviceId })}`, { signal: current.signal });
    if (!response.ok) throw new Error('Process discovery failed');
    const data = await response.json();
    if (!current.signal.aborted) processes.value = data.processes;
  } catch { if (!current.signal.aborted) failed.value = true; }
  finally { if (!current.signal.aborted) busy.value = false; }
}
async function open() {
  visible.value = true; query.value = '';
  await nextTick(); panel.value?.showModal(); search.value?.focus();
  void refresh();
}
function close() {
  request?.abort(); panel.value?.close(); visible.value = false;
  trigger.value?.focus({ preventScroll: true });
}
function select(process: AndroidProcess) { emit('select', String(process.pid)); close(); }
onUnmounted(() => request?.abort());
</script>
<template>
  <button ref="trigger" type="button" class="precision-action" aria-haspopup="dialog" :aria-expanded="visible" @click="open">{{ t('processFind') }}</button>
  <dialog v-if="visible" ref="panel" class="process-dialog" :aria-labelledby="`${id}-title`" :aria-describedby="`${id}-hint ${id}-select`" @cancel.prevent.stop="close" @keydown.esc.prevent.stop="close">
    <header class="process-heading">
      <div><h2 :id="`${id}-title`">{{ t('processFind') }}</h2><div class="process-device"><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="5" y="2" width="10" height="16" rx="2"/><path d="M8 15h4"/></svg><span>{{ deviceName || deviceId }}</span><span aria-hidden="true">·</span><span>Android</span></div></div>
      <button type="button" class="process-icon-button process-close" :aria-label="t('close')" @click="close"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15"/></svg></button>
    </header>
    <div class="process-tools">
      <div class="process-search"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/></svg><input ref="search" v-model="query" type="search" :aria-label="t('processSearch')" :placeholder="t('processSearch')" autocomplete="off" spellcheck="false" /></div>
      <button type="button" class="process-icon-button process-refresh" :disabled="busy" :aria-label="t('processRefresh')" :title="t('processRefresh')" @click="refresh"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16 7a6.5 6.5 0 1 0 .4 5M16 3v4h-4"/></svg></button>
    </div>
    <div class="process-meta"><span role="status">{{ !busy && !failed ? t('processMatches', { count: matches.length, total: processes.length }) : '' }}</span><span :id="`${id}-select`">{{ t('processSelectHint') }}</span></div>
    <div ref="results" class="process-results" :aria-busy="busy">
      <p v-if="busy" class="process-state" role="status">{{ t('processLoading') }}</p>
      <p v-else-if="failed" class="process-state" role="alert">{{ t('processUnavailable') }}</p>
      <p v-else-if="!matches.length" class="process-state" role="status">{{ t('processEmpty') }}</p>
      <ul v-else><li v-for="process in matches" :key="process.pid"><button type="button" class="process-row" :aria-label="t('processApply', { name: process.name, pid: String(process.pid) })" @click="select(process)"><span class="process-symbol" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="m10 2 7 4v8l-7 4-7-4V6l7-4ZM3 6l7 4 7-4M10 10v8M6.5 4l7 4"/></svg></span><span class="process-name">{{ process.name }}</span><code>{{ process.pid }}</code><svg class="process-enter" viewBox="0 0 20 20" aria-hidden="true"><path d="M16 4v7H4m4-4-4 4 4 4"/></svg></button></li></ul>
    </div>
    <footer><p :id="`${id}-hint`">{{ t('processHint') }}</p><button type="button" class="process-dismiss" @click="close"><kbd>Esc</kbd>{{ t('close') }}</button></footer>
  </dialog>
</template>
<style scoped>
#precision-design .process-dialog { box-sizing:border-box; width:min(520px,calc(100vw - 24px)); max-width:none; max-height:calc(100dvh - 24px); padding:0; border:1px solid var(--pl-line); border-radius:16px; color:var(--pl-text); background:var(--pl-panel); box-shadow:0 20px 65px #13213f35; font:13px/1.5 system-ui,sans-serif; overflow:hidden; }
#precision-design .process-dialog[open] { display:flex; flex-direction:column; }
.process-dialog::backdrop { background:#1b233a55; }
#precision-design .process-dialog * { box-sizing:border-box; }
#precision-design .process-dialog svg { width:18px; height:18px; flex-shrink:0; fill:none; stroke:currentColor; stroke-width:1.5; stroke-linecap:round; stroke-linejoin:round; }
#precision-design .process-dialog button { font:inherit; cursor:pointer; color:inherit; }
#precision-design .process-dialog .process-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:22px 24px 18px; flex-shrink:0; }
#precision-design .process-dialog h2 { font-size:18px; line-height:1.3; font-weight:650; letter-spacing:-.3px; margin:0; }
#precision-design .process-dialog .process-device { display:flex; align-items:center; gap:6px; color:var(--pl-soft); font-size:12px; margin-top:6px; overflow-wrap:anywhere; }
#precision-design .process-dialog .process-device span:last-child { flex-shrink:0; white-space:nowrap; }
#precision-design .process-dialog .process-icon-button { display:grid; place-items:center; padding:0; width:42px; height:42px; flex-shrink:0; border:1px solid var(--pl-line); border-radius:9px; background:var(--pl-panel); color:var(--pl-soft); }
#precision-design .process-dialog .process-close { width:32px; height:32px; border-color:transparent; }
#precision-design .process-dialog .process-icon-button:hover { background:var(--pl-wash); color:var(--pl-text); }
#precision-design .process-dialog .process-tools { display:flex; gap:8px; padding:0 24px 16px; flex-shrink:0; }
#precision-design .process-dialog .process-search { display:flex; align-items:center; gap:10px; padding:0 12px; height:42px; min-width:0; flex:1; border:1px solid var(--pl-line); border-radius:9px; background:var(--pl-wash); color:var(--pl-soft); }
#precision-design .process-dialog .process-search:focus-within { border-color:var(--pl-accent); box-shadow:0 0 0 3px color-mix(in srgb,var(--pl-accent) 12%,transparent); }
#precision-design .process-dialog .process-search input { display:block; padding:0; width:100%; min-width:0; border:0; outline:none; box-shadow:none; background:transparent; color:var(--pl-text); font:inherit; }
#precision-design .process-dialog .process-meta { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:4px 12px; padding:0 24px 10px; font-size:11px; color:var(--pl-soft); flex-shrink:0; }
#precision-design .process-dialog .process-results { height:312px; min-height:0; flex:0 1 312px; overflow-y:auto; overscroll-behavior:contain; scrollbar-gutter:stable; border-top:1px solid var(--pl-line); padding:6px 12px; }
#precision-design .process-dialog ul { list-style:none; margin:0; padding:0; }
#precision-design .process-dialog .process-row { display:flex; align-items:center; gap:12px; width:100%; min-height:54px; padding:10px 12px; border:0; border-radius:8px; background:transparent; text-align:left; }
#precision-design .process-dialog .process-row:hover,#precision-design .process-dialog .process-row:focus-visible { background:var(--pl-accent-bg); }
#precision-design .process-dialog .process-symbol { display:grid; place-items:center; width:30px; height:30px; flex-shrink:0; border:1px solid var(--pl-line); border-radius:8px; background:var(--pl-panel); color:var(--pl-soft); }
#precision-design .process-dialog .process-name { flex:1; min-width:0; overflow-wrap:anywhere; font-size:12px; font-weight:500; }
#precision-design .process-dialog code { flex-shrink:0; color:var(--pl-soft); font:12px ui-monospace,SFMono-Regular,Consolas,monospace; font-variant-numeric:tabular-nums; letter-spacing:0; }
#precision-design .process-dialog .process-enter { width:16px; color:var(--pl-accent); opacity:0; }
#precision-design .process-dialog .process-row:hover .process-enter,#precision-design .process-dialog .process-row:focus-visible .process-enter { opacity:1; }
#precision-design .process-dialog .process-state { margin:0; padding:32px 12px; color:var(--pl-soft); font-size:13px; text-align:center; }
#precision-design .process-dialog footer { display:flex; align-items:center; justify-content:space-between; flex-shrink:0; gap:12px; padding:14px 24px; border-top:1px solid var(--pl-line); background:var(--pl-wash); }
#precision-design .process-dialog footer p { margin:0; font-size:11px; color:var(--pl-soft); overflow-wrap:anywhere; }
#precision-design .process-dialog .process-dismiss { display:flex; align-items:center; gap:6px; padding:4px 0; border:0; background:transparent; color:var(--pl-soft); font-size:11px; white-space:nowrap; }
#precision-design .process-dialog kbd { border:1px solid var(--pl-line); border-radius:4px; background:var(--pl-panel); padding:2px 5px; font:11px ui-monospace,monospace; }
#precision-design .process-dialog button:focus-visible { outline:2px solid var(--pl-accent); outline-offset:-2px; }
@media(max-width:600px) {
  #precision-design .process-dialog { margin:auto auto 12px; }
  #precision-design .process-dialog .process-heading { padding:18px 16px 14px; }
  #precision-design .process-dialog .process-tools { padding:0 16px 14px; }
  #precision-design .process-dialog .process-meta { padding:0 16px 10px; }
  #precision-design .process-dialog .process-search input { font-size:16px; }
  #precision-design .process-dialog .process-results { height:300px; flex-basis:300px; padding:6px; }
  #precision-design .process-dialog .process-row { gap:8px; padding:8px; }
  #precision-design .process-dialog .process-enter { display:none; }
  #precision-design .process-dialog footer { padding:12px 16px; }
}
@media(pointer:coarse) {
  #precision-design .process-dialog .process-icon-button { min-width:44px; min-height:44px; }
  #precision-design .process-dialog .process-dismiss { min-height:44px; }
}
</style>

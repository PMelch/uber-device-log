<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import type { Device } from '../../shared/types';
import { unityTranslate, type UnityMessageKey } from '../plugins/unity/catalog';
const props = defineProps<{ locale: string; selected: string; deviceState: (state: string) => string }>();
const emit = defineEmits<{ select: [device: Device] }>();
interface UnityState { enabled: boolean; projectName?: string; packagePath?: string; paired: boolean; sources: { id: string; name: string; state: string; received: number; dropped: number; lastSeen: number }[] }
interface Pairing { code: string; projectId: string; expiresAt: number | string }
const state = ref<UnityState>();
const pairing = ref<Pairing>();
const failed = ref(false), busy = ref(false);
const origin = typeof window === 'undefined' ? '' : window.location.origin;
const u = (key: UnityMessageKey) => unityTranslate(props.locale, key);
const number = (value: number) => new Intl.NumberFormat(props.locale).format(value);
const expires = (value: number | string) => typeof value === 'number' ? value : Date.parse(value);
let disposed = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let expiryTimer: ReturnType<typeof setTimeout> | undefined;
const requests = new Set<AbortController>();
async function request(path: string, init: RequestInit = {}) {
 const controller = new AbortController(); requests.add(controller);
 try {
  const response = await fetch(path, { ...init, signal: controller.signal, cache: 'no-store' });
  if (!response.ok) throw new Error('Unity request failed');
  return response;
 } finally { requests.delete(controller); }
}
async function refresh() {
 try {
  const response = await request('/api/unity/state');
  const next: UnityState = await response.json();
  if (disposed) return;
  state.value = next;
  if (!next.enabled) pairing.value = undefined;
  failed.value = false;
 } catch { if (!disposed) failed.value = true; }
}
async function poll() {
 await refresh();
 if (!disposed) timer = setTimeout(poll, 3000);
}
async function mutate(method: 'POST' | 'DELETE') {
 if (busy.value || !state.value?.enabled) return;
 if (method === 'DELETE' && !window.confirm(u('revokeConfirm'))) return;
 busy.value = true; failed.value = false; pairing.value = undefined; clearTimeout(expiryTimer);
 try {
  const response = await request('/api/unity/pairing', { method, headers: { 'X-UDL-Unity': '1', 'Content-Type': 'application/json' }, ...(method === 'POST' ? { body: '{}' } : {}) });
  if (method === 'POST') {
   const next: Pairing = await response.json();
   if (disposed) return;
   pairing.value = next;
   expiryTimer = setTimeout(() => { pairing.value = undefined; }, Math.max(0, expires(next.expiresAt) - Date.now()));
  }
  await refresh();
 } catch { if (!disposed) failed.value = true; }
 finally { busy.value = false; }
}
onMounted(poll);
onUnmounted(() => {
 disposed = true; clearTimeout(timer); clearTimeout(expiryTimer);
 for (const request of requests) request.abort();
 pairing.value = undefined;
});
</script>

<template>
 <details class="unity-sources">
  <summary>{{ u('projectSources') }} · {{ u('editor') }}<span v-if="state?.projectName"> · {{ state.projectName }}</span></summary>
  <div class="unity-panel">
   <p v-if="failed" role="alert">{{ u('error') }}</p>
   <p v-if="!state && !failed" role="status">{{ u('loading') }}</p>
   <p v-if="state && !state.enabled">{{ u('disabled') }}</p>
   <template v-if="state?.enabled">
    <p>{{ u('install') }}</p><code class="unity-path">{{ state.packagePath }}</code>
    <p>{{ u('pairInstructions') }}</p>
    <div class="unity-actions"><button type="button" class="precision-action" :disabled="busy" @click="mutate('POST')">{{ u('pair') }}</button><button type="button" class="precision-action" :disabled="busy" @click="mutate('DELETE')">{{ u('revoke') }}</button></div>
    <dl v-if="pairing" class="unity-pairing">
     <dt>{{ u('url') }}</dt><dd><code>{{ origin }}</code></dd>
     <dt>{{ u('projectId') }}</dt><dd><code>{{ pairing.projectId }}</code></dd>
     <dt>{{ u('code') }}</dt><dd><code>{{ pairing.code }}</code></dd>
     <dt>{{ u('expires') }}</dt><dd>{{ new Date(expires(pairing.expiresAt)).toLocaleTimeString(locale) }}</dd>
    </dl>
    <p role="status">{{ u(state.paired ? 'paired' : 'unpaired') }}</p>
    <p>{{ u('viewerHint') }}</p>
    <p v-if="!state.sources.length">{{ u('empty') }}</p>
    <ul v-else class="unity-list"><li v-for="source in state.sources" :key="source.id">
     <button type="button" class="precision-action" :disabled="source.state !== 'connected'" :aria-pressed="selected === 'unity:' + source.id" @click="emit('select', { id: source.id, name: source.name, state: source.state, platform: 'unity' })">{{ source.name }} · {{ deviceState(source.state) }}</button>
     <span>{{ u('received') }}: {{ number(source.received) }} · {{ u('dropped') }}: {{ number(source.dropped) }}</span>
    </li></ul>
   </template>
  </div>
 </details>
</template>

<style scoped>
.unity-sources { margin: 0 0 12px; border: 1px solid var(--pl-line); border-radius: 8px; background: var(--pl-panel); color: var(--pl-text); min-width: 0; font-size: 12px; }
#precision-design .unity-sources summary { white-space: normal; flex-wrap: wrap; cursor: pointer; padding: 12px; overflow-wrap: anywhere; }
.unity-panel { padding: 0 12px 12px; display: grid; gap: 10px; min-width: 0; }
.unity-panel p { margin: 0; line-height: 1.5; }
.unity-path, .unity-pairing dd { overflow-wrap: anywhere; white-space: pre-wrap; }
.unity-actions { display: flex; flex-wrap: wrap; gap: 8px; }
#precision-design .unity-actions button, #precision-design .unity-list button { white-space: normal; min-height: 36px; text-align: start; }
.unity-pairing { display: grid; grid-template-columns: auto minmax(0,1fr); gap: 6px 16px; margin: 0; }
.unity-pairing dd { margin: 0; user-select: all; }
.unity-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
.unity-list li { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
button:focus-visible, summary:focus-visible { outline: 2px solid var(--pl-accent); outline-offset: 2px; }
@media (max-width: 700px) { .unity-pairing { grid-template-columns: minmax(0,1fr); gap: 4px; } .unity-pairing dd { margin-bottom: 8px; } }
</style>

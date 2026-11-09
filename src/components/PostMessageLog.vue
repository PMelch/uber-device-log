<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import type { ConsoleContext, ConsoleState } from '../../shared/console';
import type { MessageCapture, MessageRecord } from '../../shared/postmessage';
import { translate, type Locale } from '../i18n';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../../shared/notifications';
import { compactContextUrl } from '../webview-label';
import FeatureStatusBadge from './FeatureStatusBadge.vue';
import { featureStatuses } from '../feature-status';
const props = defineProps<{ session: string; context: string; state: ConsoleState; locale: Locale; contextTarget?: HTMLElement }>();
const t = (key: MessageKey, params?: MessageParams) => translate(props.locale, key, params);
const capture = ref<MessageCapture>({ active: false, revision: -1, contexts: [], unavailable: [], records: [], dropped: 0 });
const records = ref<MessageRecord[]>([]), frozen = ref<MessageRecord[] | null>(null);
const retainedContexts = ref<ConsoleContext[]>([]);
const viewContext = ref(props.context);
const contexts = computed(() => new Map([...retainedContexts.value, ...props.state.contexts].map(item => [item.key, item])));
function contextLabel(item: ConsoleContext, full = false) {
  const location = item.url || item.frame;
  const name = item.name || (item.top ? 'top' : 'iframe');
  if (full) return `${name} · ${location}`;
  const shortLocation = compactContextUrl(location);
  if (name === location) return shortLocation;
  const shortName = /^[a-z][\w+.-]*:/i.test(name) ? compactContextUrl(name) : name;
  return `${shortName} · ${shortLocation}`;
}
const displayLabels = computed(() => {
  const labels = new Map<string, string>();
  const seen = new Set<string>(), duplicates = new Set<string>();
  for (const item of contexts.value.values()) {
    const name = contextLabel(item);
    labels.set(item.key, name);
    if (seen.has(name)) duplicates.add(name);
    seen.add(name);
  }
  for (const [key, name] of labels) {
    if (duplicates.has(name)) labels.set(key, `${name} · ${key}`);
  }
  return labels;
});
watch(() => props.context, key => { if (key) viewContext.value = key; });
const busy = ref(false), error = ref(false), lost = ref(0), query = ref(''), direction = ref('both');
let disposed = false, generation = 0, stopping = false, pendingPoll: Promise<void> | undefined, timer: ReturnType<typeof setTimeout> | undefined;
const visible = computed(() => (frozen.value ?? records.value).filter(row => {
  const incoming = row.receiver === viewContext.value, outgoing = row.source === viewContext.value;
  return (direction.value === 'in' ? incoming : direction.value === 'out' ? outgoing : incoming || outgoing)
    && `${row.origin} ${row.data}`.toLowerCase().includes(query.value.toLowerCase());
}));
function label(key: string | null, full = false) {
  const item = key && contexts.value.get(key);
  if (!item) return key || t('messageUnknown');
  return full ? contextLabel(item, true) : displayLabels.value.get(item.key)!;
}
async function request(method: string) {
  const response = await fetch(`/api/console/${props.session}/messages`, { method,
    ...(method === 'POST' ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: props.state.revision }) } : {}) });
  if (!response.ok) throw new Error();
  return response.status === 204 ? undefined : await response.json() as MessageCapture;
}
function apply(next: MessageCapture) {
  capture.value = next;
  lost.value += next.dropped + Math.max(0, records.value.length + next.records.length - 500);
  records.value = [...records.value, ...next.records].slice(-500);
}
function tick() { pendingPoll = poll(); }
async function poll() {
  if (disposed) return;
  const version = generation;
  try {
    const next = await request('GET');
    if (disposed || version !== generation || !next) return;
    apply(next);
  } catch { if (!disposed && version === generation) { error.value = true; capture.value.active = false; } }
  if (!disposed && version === generation && !stopping && capture.value.active) timer = setTimeout(tick, 1000);
}
async function start() {
  if (busy.value) return;
  ++generation; busy.value = true; error.value = false; clearTimeout(timer);
  try {
    const next = await request('POST');
    if (disposed || !next) return;
    capture.value = next; records.value = []; frozen.value = null; lost.value = 0;
    retainedContexts.value = [...props.state.contexts];
    if (next.active) tick();
  } catch { if (!disposed) error.value = true; }
  finally { busy.value = false; }
}
async function stop() {
  stopping = true; busy.value = true; clearTimeout(timer);
  try {
    await pendingPoll;
    if (disposed) return;
    const final = await request('DELETE');
    if (!disposed && final) apply(final);
  } catch { if (!disposed) error.value = true; }
  finally {
    busy.value = false; stopping = false;
    if (!disposed && capture.value.active) timer = setTimeout(tick, 1000);
  }
}
function clear() { records.value = []; if (frozen.value) frozen.value = []; lost.value = 0; }
function save() {
  const blob = new Blob([JSON.stringify(visible.value.map(row => ({ ...row, sourceLabel: label(row.source, true), receiverLabel: label(row.receiver, true) })), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = 'postmessage.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
onUnmounted(() => { disposed = true; clearTimeout(timer); if (props.session) void fetch(`/api/console/${props.session}/messages`, { method: 'DELETE', keepalive: true }).catch(() => {}); });
</script>
<template>
  <section class="message-log" :aria-label="t('messageTitle')">
    <h3>{{ t('messageTitle') }} <FeatureStatusBadge :status="featureStatuses.postMessageLog" :t="t" /></h3>
    <p>{{ t('messageScope') }}</p>
    <Teleport :to="contextTarget ?? 'body'" :disabled="!contextTarget">
      <label class="message-context">{{ t('messageContext') }}
        <select v-model="viewContext" :disabled="!contexts.size" :title="viewContext ? label(viewContext, true) : undefined">
          <option value="" disabled>{{ t('consoleChoose') }}</option>
          <option v-for="item in contexts.values()" :key="item.key" :value="item.key" :title="contextLabel(item, true)">{{ displayLabels.get(item.key) }}</option>
        </select>
      </label>
    </Teleport>
    <div class="actions">
      <button :disabled="busy || !session || !state.connected || (!capture.active && !state.contexts.some(c => c.key === viewContext))" @click="capture.active ? stop() : start()">{{ t(capture.active ? 'messageStop' : 'messageStart') }}</button>
      <button :disabled="!records.length" :aria-pressed="!!frozen" @click="frozen = frozen ? null : [...records]">{{ t(frozen ? 'messageResume' : 'messagePause') }}</button>
      <button @click="clear">{{ t('messageClear') }}</button>
      <button :disabled="!visible.length" @click="save">{{ t('messageSave') }}</button>
    </div>
    <p role="status">{{ t(capture.active && capture.revision === state.revision ? 'messageActive' : 'messageStopped') }} · {{ t('messageCoverage', { count: capture.contexts.length.toLocaleString(locale), total: state.contexts.length.toLocaleString(locale) }) }}</p>
    <p v-if="capture.revision >= 0 && capture.revision !== state.revision">{{ t('messageNavigation') }}</p>
    <p v-if="lost">{{ t('messageDropped', { count: lost.toLocaleString(locale) }) }}</p>
    <p v-if="error" role="alert">{{ t('messageError') }}</p>
    <label>{{ t('messageDirection') }}<select v-model="direction"><option value="both">{{ t('messageBoth') }}</option><option value="in">{{ t('messageIncoming') }}</option><option value="out">{{ t('messageOutgoing') }}</option></select></label>
    <label>{{ t('messageSearch') }}<input v-model="query" type="search" /></label>
    <p v-if="!visible.length">{{ t('messageEmpty') }}</p>
    <article v-for="row in visible" :key="row.id">
      <div>{{ new Date(row.time).toLocaleTimeString(locale) }} · {{ t(row.receiver === viewContext ? 'messageIncoming' : 'messageOutgoing') }}</div>
      <div><span :title="label(row.source, true)">{{ label(row.source) }}</span> → <span :title="label(row.receiver, true)">{{ label(row.receiver) }}</span></div><code>{{ row.origin }}</code>
      <details><summary>{{ t('messagePayload') }}</summary><pre>{{ row.data }}</pre></details>
    </article>
  </section>
</template>
<style scoped>
.message-log { padding: 16px 20px; overflow: auto; flex: 1; min-height: 0; font-size: 12px; }
h3 { display: flex; align-items: center; gap: 6px; margin: 0; }p { color: var(--pl-soft); overflow-wrap: anywhere; }
.actions { display: flex; flex-wrap: wrap; gap: 6px; }button,input,select { font: inherit; color: var(--pl-text); background: var(--pl-panel); border: 1px solid var(--pl-line); border-radius: 6px; padding: 8px; }button { cursor: pointer; }button:disabled { opacity: .5; cursor: default; }
label { display: block; margin: 8px 0; }input,select { display: block; width: 100%; margin-top: 4px; min-width: 0; }article { border-top: 1px solid var(--pl-line); padding: 10px 0; overflow-wrap: anywhere; }pre { white-space: pre-wrap; overflow-wrap: anywhere; }summary { cursor: pointer; padding: 6px 0; }
:focus-visible { outline: 2px solid var(--pl-accent); outline-offset: 2px; }
@media(max-width:600px) { .message-log { padding: 12px; } }
</style>

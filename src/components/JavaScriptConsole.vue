<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import type { ConsoleResult, ConsoleState, ConsoleErrorCode, ConsoleValue as ConsoleValueData, ConsoleProperties } from '../../shared/console';
import type { LogSource } from '../../shared/types';
import { translate, type Locale } from '../i18n';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../../shared/notifications';
import { webViewLabel } from '../webview-label';
import ConsoleValue from './ConsoleValue.vue';
import InspectorAction from './InspectorAction.vue';
import FeatureStatusBadge from './FeatureStatusBadge.vue';
import { featureStatuses } from '../feature-status';
const props = defineProps<{ sources: LogSource[]; initial: string; locale: Locale }>();
const emit = defineEmits<{ close: [] }>();
const t = (key: MessageKey, params?: MessageParams) => translate(props.locale, key, params);
const panel = ref<HTMLDialogElement>();
const editor = ref<HTMLTextAreaElement>();
const selected = ref(props.initial), session = ref(''), context = ref(''), code = ref('');
const state = ref<ConsoleState>({ revision: 0, connected: false, contexts: [] });
const error = ref<ConsoleErrorCode>(), busy = ref(false), connecting = ref(false), clearing = ref(false), copied = ref(-1);
const history = ref<string[]>([]);
const results = ref<(ConsoleResult & { expression: string; scope: string; session: string })[]>([]);
let generation = 0, disposed = false, timer: ReturnType<typeof setTimeout> | undefined;
const previousFocus = document.activeElement as HTMLElement | null;
const target = computed(() => props.sources.find(s => s.key === selected.value));
const ready = computed(() => !!session.value && !!context.value && state.value.connected && !busy.value && !connecting.value && !clearing.value);
const errors = new Set<ConsoleErrorCode>(['consoleUnavailable', 'consoleStale', 'consoleTimeout', 'consoleBusy', 'consoleInvalid']);
async function request(path: string, body?: unknown, method?: string) {
  const response = await fetch(`/api/console${path}`, { method: method ?? (body ? 'POST' : 'GET'), headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  if (response.status === 204) return;
  const data = await response.json();
  if (!response.ok) throw errors.has(data.code) ? data.code : 'consoleUnavailable';
  return data;
}
function report(e: unknown) { error.value = errors.has(e as ConsoleErrorCode) ? e as ConsoleErrorCode : 'consoleUnavailable'; }
function release(id: string) { if (id) void fetch(`/api/console/${id}`, { method: 'DELETE', keepalive: true }).catch(() => {}); }
function apply(next: ConsoleState) {
  if (context.value && (next.revision !== state.value.revision || !next.contexts.some(c => c.key === context.value))) {
    context.value = ''; error.value = 'consoleStale';
  }
  state.value = next;
}
async function poll(token: string, version: number) {
  if (disposed || version !== generation) return;
  try { const data = await request(`/${token}`); if (version === generation) apply(data); }
  catch (e) { if (version === generation) { report(e); state.value.connected = false; context.value = ''; } }
  if (!disposed && version === generation) timer = setTimeout(() => { void poll(token, version); }, 1000);
}
async function connect() {
  const version = ++generation;
  clearTimeout(timer); release(session.value); session.value = ''; context.value = ''; error.value = undefined;
  state.value = { revision: 0, connected: false, contexts: [] };
  const device = target.value?.device;
  if (!device?.webview) return;
  connecting.value = true;
  try {
    const data = await request('', { platform: device.platform, id: device.id, socket: device.webview.socket, target: device.webview.id });
    if (disposed || version !== generation) { release(data.id); return; }
    session.value = data.id; apply(data); void poll(data.id, version);
  } catch (e) { if (version === generation) report(e); }
  finally { if (version === generation) connecting.value = false; }
}
function location(url: string) { try { const parsed = new URL(url); return (parsed.host + parsed.pathname).slice(0, 100); } catch { return url.slice(0, 100); } }
function scopeLabel(c: ConsoleState['contexts'][number]) { const label = c.top ? t('consoleTop') : `${c.name || 'iframe'} · ${location(c.url) || c.frame}`; return `${'\u00a0\u00a0\u00a0'.repeat(Math.min(c.depth ?? 0, 20))}${c.depth ? '↳ ' : ''}${label}`; }
async function execute() {
  if (!ready.value || !code.value.trim()) return;
  const version = generation, token = session.value, expression = code.value, revision = state.value.revision;
  const scope = state.value.contexts.find(c => c.key === context.value);
  busy.value = true; error.value = undefined;
  history.value = [expression, ...history.value.filter(item => item !== expression)].slice(0, 50);
  try {
    const result: ConsoleResult = await request(`/${token}/execute`, { context: context.value, revision, expression });
    if (version === generation && !disposed) results.value = [...results.value, { ...result, expression, scope: scope ? `${scope.name || (scope.top ? 'top' : 'iframe')} · ${location(scope.url)}` : '', session: token }].slice(-50);
  } catch (e) { if (version === generation) { report(e); if (e === 'consoleStale') context.value = ''; } }
  finally { if (!disposed) busy.value = false; }
}
async function inspect(result: typeof results.value[number], value: ConsoleValueData, offset: number): Promise<ConsoleProperties> {
  const token = session.value, version = generation;
  if (!value.handle || result.session !== token || result.revision !== state.value.revision) throw 'consoleStale';
  const page: ConsoleProperties = await request(`/${token}/properties`, { handle: value.handle, revision: result.revision, offset });
  if (disposed || version !== generation || result.revision !== state.value.revision || !results.value.includes(result)) throw 'consoleStale';
  value.children = offset === 0 ? page.children : [...(value.children ?? []), ...page.children];
  value.truncated = page.nextOffset !== undefined;
  return page;
}
async function clearResults() {
  if (busy.value || clearing.value) return;
  const token = session.value, version = generation;
  clearing.value = true; results.value = []; copied.value = -1;
  try { if (token) await request(`/${token}/results`, undefined, 'DELETE'); }
  catch (e) { if (version === generation) report(e); }
  finally { clearing.value = false; }
}
async function copy(index: number) {
  try { await navigator.clipboard.writeText(JSON.stringify(results.value[index]?.value, (key, value) => key === 'handle' ? undefined : value, 2)); copied.value = index; }
  catch { copied.value = -1; }
}
watch(selected, connect);
watch(() => props.initial, value => { selected.value = value; });
watch(target, value => { if (!value) { ++generation; clearTimeout(timer); release(session.value); session.value = ''; context.value = ''; state.value.connected = false; error.value = 'consoleUnavailable'; } });
onMounted(async () => { panel.value?.showModal(); await connect(); await nextTick(); editor.value?.focus(); });
onUnmounted(() => { disposed = true; ++generation; clearTimeout(timer); release(session.value); previousFocus?.focus(); });
</script>
<template>
  <Teleport to="body">
  <dialog ref="panel" class="js-console" :aria-label="t('consoleTitle')" @cancel.prevent="emit('close')">
    <header><div><span class="console-icon" aria-hidden="true">&gt;_</span><strong>{{ t('consoleTitle') }}</strong><FeatureStatusBadge :status="featureStatuses.javascriptConsole" :t="t" /></div><button :aria-label="t('close')" @click="emit('close')">×</button></header>
    <section class="console-targets">
      <label>{{ t('consoleTarget') }}<select v-model="selected" :disabled="busy"><option v-for="source in sources" :key="source.key" :value="source.key">{{ webViewLabel(source.device.webview!).name }} · {{ source.device.name }}</option></select></label>
      <label>{{ t('consoleContext') }}<select v-model="context" :disabled="busy || !state.connected" @change="error = undefined"><option value="" disabled>{{ t('consoleChoose') }}</option><option v-for="item in state.contexts" :key="item.key" :value="item.key">{{ scopeLabel(item) }}</option></select></label>
      <InspectorAction v-if="target?.device.webview" :key="target.key" :source="{ key: target.key, name: target.device.name, platform: target.device.platform, deviceId: target.device.id, webview: target.device.webview }" :t="t" />
      <p class="console-scope">{{ t('consoleScope') }}</p>
      <div class="console-status"><span :class="{ connected: state.connected && state.contexts.length }">●</span>{{ t(state.connected && state.contexts.length ? 'consoleReady' : 'consoleWaiting') }}<button :disabled="busy || connecting" @click="connect">{{ t('reconnect') }}</button></div>
    </section>
    <div class="console-output" aria-live="polite">
      <div v-if="!results.length" class="console-empty"><span aria-hidden="true">{ }</span><p>{{ t('consoleEmpty') }}</p><button v-for="example in ['document.title', 'window.location.href', 'Object.keys(window)']" :key="example" @click="code = example; editor?.focus()"><code>{{ example }}</code></button></div>
      <article v-for="(result, index) in results" :key="index" :class="{ 'console-exception': result.exception }">
        <div class="console-result-meta"><span>{{ result.scope }}</span><span>{{ result.value.type }} · {{ result.elapsed }} ms</span></div>
        <small v-if="result.session !== session || result.revision !== state.revision">{{ t('consoleOld') }}</small>
        <pre class="console-expression">&gt; {{ result.expression }}</pre>
        <ConsoleValue :value="result.value" :limited="t('consoleTruncated')" :t="t" :available="result.session === session && result.revision === state.revision && state.connected" :inspect="(value, offset) => inspect(result, value, offset)" />
        <button class="console-copy" @click="copy(index)">{{ t(copied === index ? 'copiedAction' : 'consoleCopy') }}</button>
      </article>
    </div>
    <footer>
      <p v-if="error" class="console-error" role="alert">{{ t(error) }}</p>
      <div class="console-editor"><textarea ref="editor" v-model="code" :aria-label="t('consoleCode')" spellcheck="false" maxlength="16384" placeholder="document.title" @keydown.enter="($event.metaKey || $event.ctrlKey) && ($event.preventDefault(), execute())" /></div>
      <div class="console-actions"><select :aria-label="t('consoleHistory')" value="" @change="code = ($event.target as HTMLSelectElement).value; ($event.target as HTMLSelectElement).value = ''"><option value="" disabled>{{ t('consoleHistory') }}</option><option v-for="(command, index) in history" :key="index" :value="command">{{ command }}</option></select><button class="console-clear" :disabled="busy || clearing" @click="clearResults">{{ t('consoleClear') }}</button><button class="console-run" :disabled="!ready || !code.trim()" title="⌘ / Ctrl + Enter" @click="execute">{{ t(busy ? 'consoleRunning' : 'consoleRun') }} <span aria-hidden="true">↵</span></button></div>
      <small>{{ t('consolePreview') }}</small>
    </footer>
  </dialog>
  </Teleport>
</template>
<style scoped>
.js-console { --pl-panel: #fff; --pl-text: #24252c; --pl-soft: #737782; --pl-line: #e2e4ea; --pl-accent: #2466df; position: fixed; inset: 12px 12px 12px auto; width: min(560px, calc(100vw - 24px)); height: calc(100dvh - 24px); max-height: none; max-width: none; margin: 0; padding: 0; border: 1px solid var(--pl-line); border-radius: 16px; color: var(--pl-text); background: var(--pl-panel); box-shadow: 0 18px 65px #13213f30; overflow: hidden; font: 13px/1.5 system-ui,sans-serif; }
.js-console[open] { display: flex; flex-direction: column; animation: console-in 180ms ease-out; }
.js-console::backdrop { background: #1b233a20; }
.js-console * { box-sizing: border-box; }
header,footer,.console-targets { flex-shrink: 0; padding: 16px 20px; }
header { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--pl-line); }
header > div { display: flex; gap: 10px; align-items: center; }
.console-icon { color: var(--pl-accent); padding: 4px 7px; border-radius: 7px; background: var(--console-tint, #edf3ff); font-family: monospace; }
button,select,textarea { font: inherit; color: inherit; }
button { cursor: pointer; border: 0; border-radius: 7px; padding: 8px; background: transparent; }
button:hover { background: var(--console-tint, #edf3ff); }
button:disabled { opacity: .45; cursor: default; }
button:focus-visible, select:focus-visible,textarea:focus-visible { outline: 2px solid var(--pl-accent); outline-offset: 2px; }
header > button { font-size: 22px; width: 36px; height: 36px; padding: 0; }
.console-targets { background: var(--console-wash, #f8f9fc); border-bottom: 1px solid var(--pl-line); }
label { display: block; font-size: 11px; font-weight: 600; color: var(--pl-soft); margin-bottom: 8px; }
select { width: 100%; min-width: 0; margin-top: 4px; padding: 9px; border: 1px solid var(--pl-line); border-radius: 7px; background: var(--pl-panel); font-size: 12px; color: var(--pl-text); text-overflow: ellipsis; }
.console-scope { font-size: 11px; color: var(--pl-soft); margin: 8px 0; }
.console-status { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--pl-soft); }
.console-status > span { color: #b68328; }.console-status .connected { color: #24874c; }.console-status button { margin-left: auto; padding: 3px 6px; }
.console-output { flex: 1; min-height: 60px; overflow: auto; padding: 16px 20px; }
.console-empty { padding: 20px 0; color: var(--pl-soft); }.console-empty > span { font: 26px monospace; color: #9babca; }.console-empty button { display: block; border: 1px solid var(--pl-line); margin: 6px 0; font-size: 12px; color: var(--pl-text); }
article { border: 1px solid var(--pl-line); border-radius: 9px; margin-bottom: 12px; padding: 12px; overflow-wrap: anywhere; }.console-exception { background: var(--console-error-bg, #fff4f4); border-color: #efc6c6; }
.console-result-meta { display: flex; gap: 10px; justify-content: space-between; color: var(--pl-soft); font-size: 10px; }.console-result-meta span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.console-result-meta span:last-child { white-space: nowrap; }
.console-expression { white-space: pre-wrap; font: 12px/1.6 monospace; border-bottom: 1px solid var(--pl-line); padding-bottom: 8px; }.console-copy { display: block; margin: 8px 0 0 auto; font-size: 10px; color: var(--pl-soft); }
footer { border-top: 1px solid var(--pl-line); background: var(--console-wash, #f8f9fc); }textarea { display: block; resize: vertical; min-height: 64px; max-height: 180px; width: 100%; border: 1px solid var(--pl-line); border-radius: 8px; background: var(--pl-panel); padding: 10px; font: 12px/1.6 monospace; }
.console-actions { display: flex; gap: 8px; align-items: center; margin: 10px 0; }.console-actions select { flex: 1; width: 0; margin: 0; }.console-actions button { font-size: 11px; }.console-actions .console-run { background: var(--pl-accent); color: #fff; padding: 9px 14px; }footer small,article > small { font-size: 10px; color: var(--pl-soft); }.console-error { color: #a22b35; font-size: 12px; margin: 0 0 10px; }
:global(:root[data-theme=dark] .js-console) { --pl-panel: #1c1e24; --pl-text: #eceef3; --pl-soft: #a2a7b6; --pl-line: #383c48; --pl-accent: #8cb5ff; --console-tint: #24364f; --console-wash: #22252c; --console-error-bg: #36272c; }
@keyframes console-in { from { opacity: 0; transform: translateX(12px); } to { opacity: 1; transform: translateX(0); } }
@media(max-width:600px) { .js-console { inset: 0; width: 100%; height: 100dvh; border-radius: 0; } header,footer,.console-targets { padding: 12px; }.console-output { padding: 12px; } }
@media(prefers-reduced-motion:reduce) { .js-console[open] { animation: none; } }
</style>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import type { FlowDiagnostic, FlowSnapshot, FlowSource } from '../../shared/flow-types';
import { translate, translateMessage, type Locale } from '../i18n';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../../shared/notifications';
const props = defineProps<{ snapshot: FlowSnapshot; locale: Locale }>();
const emit = defineEmits<{ changed: [] }>();
const t = (key: MessageKey, params?: MessageParams) => translate(props.locale, key, params);
const url = ref(''), scope = ref<'global' | 'project'>(props.snapshot.context === 'project' ? 'project' : 'global');
const busy = ref<'install' | 'activation'>(), status = ref<MessageKey>(), diagnostics = ref<FlowDiagnostic[]>([]);
const query = ref(''), selectedId = ref<string>(), installOpen = ref(false);
const urlInput = ref<HTMLInputElement>();
const sources = computed(() => props.snapshot.sources ?? []);
watch(sources, current => {
  if (!current.some(item => item.id === selectedId.value)) {
    selectedId.value = (current.find(item => item.kind === 'bundle' && item.enabled) ?? current[0])?.id;
  }
}, { immediate: true });
const filtered = computed(() => {
  const search = query.value.trim().toLocaleLowerCase(props.locale);
  return sources.value.filter(item => !search || [item.name, item.description, item.filename, item.id,
    t(item.scope === 'global' ? 'flowsScopeGlobal' : 'flowsScopeProject'),
    t(item.kind === 'bundle' ? 'flowsSourceBundle' : 'flowsSourceLoose')].join(' ').toLocaleLowerCase(props.locale).includes(search));
});
const groups = computed(() => (['global', 'project'] as const).map(scope => ({ scope, items: filtered.value.filter(item => item.scope === scope) })).filter(group => group.items.length));
const selected = computed(() => filtered.value.find(item => item.id === selectedId.value)
  ?? filtered.value[0]);
function sourceDiagnostics(source: FlowSource) {
  return [...source.diagnostics, ...props.snapshot.diagnostics.filter(item => item.code === 'flowsSourceConflict'
    && source.enabled && source.blueprintIds.includes(String(item.params.id))
    && String(item.params.sources).split(', ').some(origin => origin === source.id || origin.startsWith(source.id + '/')))];
}
function partial(source: FlowSource) { return source.enabled && source.activeBlueprintIds.length < source.blueprintIds.length; }
function needsAttention(source: FlowSource) { return sourceDiagnostics(source).length > 0 || partial(source); }
const selectedDiagnostics = computed(() => selected.value ? sourceDiagnostics(selected.value) : []);
const inventory = computed(() => selected.value?.blueprintIds.map(id => ({ id,
  name: props.snapshot.blueprints.find(item => item.sourceId === selected.value?.id && item.id === id)?.name ?? id,
})) ?? []);
function count(value: number) { return value.toLocaleString(props.locale); }
async function openInstall() { installOpen.value = true; await nextTick(); urlInput.value?.focus(); }
let controller: AbortController | undefined;
onBeforeUnmount(() => controller?.abort());
async function request(action: 'install' | 'activation', body: object) {
  if (busy.value) return;
  busy.value = action; diagnostics.value = []; status.value = action === 'install' ? 'flowsBundleInstalling' : undefined;
  controller = new AbortController();
  try {
    const response = await fetch(`/api/flows/bundles/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Flow-Token': props.snapshot.token ?? '' }, body: JSON.stringify(body), signal: controller.signal });
    const result = await response.json();
    if (!response.ok) { diagnostics.value = result.diagnostics ?? []; status.value = response.status === 409 ? 'flowsConflict' : 'flowsNetworkError'; return; }
    status.value = action === 'install' ? 'flowsBundleInstalled' : 'flowsBundleSaved';
    emit('changed');
  } catch { status.value = controller.signal.aborted ? 'flowsBundleCancelled' : 'flowsNetworkError'; }
  finally { busy.value = undefined; controller = undefined; }
}
function toggle(source: FlowSource) { void request('activation', { sourceId: source.id, enabled: !source.enabled, revision: props.snapshot.configRevision }); }
</script>
<template>
  <details class="flow-source-manager">
    <summary>{{ t('flowsBlueprintSources') }}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg></summary>
    <header class="flow-source-header">
      <div><h2>{{ t('flowsBlueprintSources') }} <span v-if="snapshot.projectName" class="flow-source-project">{{ snapshot.projectName }}</span></h2><p>{{ t(snapshot.context === 'project' ? 'flowsContextProject' : 'flowsContextGlobal') }}</p></div>
      <button type="button" class="flow-source-install-action" aria-controls="flow-bundle-install-panel" :aria-expanded="installOpen" @click="openInstall"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" /></svg>{{ t('flowsInstallTitle') }}</button>
    </header>
    <div class="flow-source-grid">
      <div class="flow-source-browser">
        <input v-model="query" class="flow-source-search" type="search" :aria-label="t('flowsSourceSearch')" :placeholder="t('flowsSourceSearch')">
        <section v-for="group in groups" :key="group.scope" class="flow-source-group" :aria-labelledby="`flow-source-group-${group.scope}`">
          <h3 :id="`flow-source-group-${group.scope}`">{{ t(group.scope === 'global' ? 'flowsScopeGlobal' : 'flowsScopeProject') }} <span class="flow-source-count">{{ count(group.items.length) }}</span></h3>
          <ul class="flow-source-list">
            <li v-for="item in group.items" :key="item.id" :data-source-id="item.id" :class="{ 'is-selected': selected?.id === item.id }">
              <button type="button" class="flow-source-select" :aria-pressed="selected?.id === item.id" aria-controls="flow-source-details" @click="selectedId = item.id">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path v-if="item.kind === 'bundle'" d="m12 2 9 5v10l-9 5-9-5V7l9-5Zm-9 5 9 5 9-5M12 12v10M7.5 4.5l9 5" /><path v-else d="M3 6h7l2 3h9v12H3V6Z" /></svg>
                <span class="flow-source-label"><strong>{{ item.name }}</strong><span class="flow-source-meta">{{ t(item.kind === 'bundle' ? 'flowsSourceBundle' : 'flowsSourceLoose') }} · {{ t('flowsSourceStored', { count: count(item.blueprintIds.length) }) }}</span><span v-if="needsAttention(item)" class="flow-source-attention">{{ t('flowsSourceNeedsAttention') }}</span></span>
              </button>
              <button v-if="item.kind === 'bundle'" class="flow-source-switch" type="button" role="switch" :aria-checked="item.enabled" :aria-label="t(item.enabled ? 'flowsBundleDisableLabel' : 'flowsBundleEnableLabel', { name: item.name })" :disabled="!!busy || !item.enabled && !!item.diagnostics.length" @click="toggle(item)"><span class="flow-source-switch-track" aria-hidden="true"></span><span>{{ t(item.enabled ? 'flowsSourceEnabled' : 'flowsSourceDisabled') }}</span></button>
            </li>
          </ul>
        </section>
        <p v-if="!filtered.length" class="flow-source-empty" role="status">{{ t(sources.length ? 'flowsSourceNoResults' : 'flowsSourceNoSources') }}</p>
      </div>
      <section v-if="selected" id="flow-source-details" class="flow-source-inspector" aria-labelledby="flow-source-detail-title">
        <header class="flow-source-detail-header"><div><h3 id="flow-source-detail-title">{{ selected.name }}</h3><p>{{ t(selected.scope === 'global' ? 'flowsScopeGlobal' : 'flowsScopeProject') }} · {{ t(selected.kind === 'bundle' ? 'flowsSourceBundle' : 'flowsSourceLoose') }}</p></div>
          <button v-if="selected.kind === 'bundle'" class="flow-source-switch" type="button" role="switch" :aria-checked="selected.enabled" :aria-label="t(selected.enabled ? 'flowsBundleDisableLabel' : 'flowsBundleEnableLabel', { name: selected.name })" :disabled="!!busy || !selected.enabled && !!selected.diagnostics.length" @click="toggle(selected)"><span class="flow-source-switch-track" aria-hidden="true"></span><span>{{ t(selected.enabled ? 'flowsSourceEnabled' : 'flowsSourceDisabled') }}</span></button>
          <span v-else class="flow-source-meta">{{ t('flowsSourceAlwaysLoaded') }}</span>
        </header>
        <p v-if="selected.description" class="flow-source-description">{{ selected.description }}</p>
        <dl class="flow-source-properties"><dt>{{ t('flowsSourcePath') }}</dt><dd><code>{{ selected.filename }}</code></dd><dt>{{ t('flowsSourceIdentifier') }}</dt><dd><code>{{ selected.id }}</code></dd></dl>
        <div class="flow-source-recognition"><span v-if="selected.specVersion">{{ t('flowsSourceVersion', { version: String(selected.specVersion) }) }}</span><strong>{{ t('flowsSourceActive', { count: count(selected.activeBlueprintIds.length) }) }}</strong></div>
        <p v-if="partial(selected)" class="flow-warning">{{ t('flowsSourcePartial') }}</p>
        <ul v-if="selectedDiagnostics.length" class="flow-validation"><li v-for="(diagnostic,index) in selectedDiagnostics" :key="index">{{ translateMessage(locale,diagnostic) }}</li></ul>
        <section class="flow-source-inventory"><h4>{{ t('flowsSourceInventory') }} <span class="flow-source-count">{{ count(inventory.length) }}</span></h4><ul v-if="inventory.length"><li v-for="item in inventory" :key="item.id"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3h13v13M3 8h13v13H3V8Z" /></svg><div><strong>{{ item.name }}</strong><code v-if="item.name !== item.id">{{ item.id }}</code></div></li></ul><p v-else>{{ t('flowsSourceInventoryEmpty') }}</p></section>
      </section>
    </div>
    <details id="flow-bundle-install-panel" class="flow-bundle-disclosure" :open="installOpen" @toggle="installOpen = ($event.target as HTMLDetailsElement).open">
      <summary>{{ t('flowsInstallTitle') }}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg></summary>
      <form class="flow-bundle-install" :aria-busy="busy === 'install'" @submit.prevent="request('install', { url, scope })">
        <label for="flow-bundle-url">{{ t('flowsBundleUrl') }}</label><input id="flow-bundle-url" ref="urlInput" v-model="url" type="url" required :disabled="!!busy" aria-describedby="flow-bundle-help">
        <label for="flow-bundle-scope">{{ t('flowsBundleTarget') }}</label><select id="flow-bundle-scope" v-model="scope" :disabled="!!busy"><option value="global">{{ t('flowsScopeGlobal') }}</option><option value="project" :disabled="snapshot.context !== 'project'">{{ t('flowsScopeProject') }}</option></select>
        <p id="flow-bundle-help">{{ t('flowsBundleHelp') }}</p>
        <div class="flow-source-install-buttons"><button type="submit" :disabled="!!busy">{{ t('flowsBundleInstall') }}</button><button v-if="busy === 'install'" type="button" @click="controller?.abort()">{{ t('flowsBundleCancel') }}</button></div>
      </form>
    </details>
    <p v-if="status" role="status" class="flow-source-status">{{ t(status) }}</p>
    <ul v-if="diagnostics.length" role="status" class="flow-validation"><li v-for="(diagnostic,index) in diagnostics" :key="index">{{ translateMessage(locale,diagnostic) }}</li></ul>
  </details>
</template>
<style scoped>
.flow-source-manager{border:1px solid var(--pl-line);border-radius:12px;margin:0 0 16px;background:var(--pl-panel);min-width:0;overflow:clip}
.flow-source-manager summary{cursor:pointer;white-space:normal!important;border:0!important;border-radius:0!important;min-height:42px!important;padding:12px 18px!important;font-weight:600;display:flex;align-items:center;gap:10px}
.flow-source-manager svg{width:19px;height:19px;flex-shrink:0;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.flow-source-manager summary svg{margin-left:auto;transition:transform .15s}
.flow-source-manager[open]>summary svg,.flow-bundle-disclosure[open]>summary svg{transform:rotate(90deg)}
.flow-source-manager[open]>summary{border-bottom:1px solid var(--pl-line)!important;color:var(--pl-soft)}
.flow-source-header{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px;padding:22px}
.flow-source-header>div{min-width:0}.flow-source-header h2{display:flex;align-items:center;flex-wrap:wrap;gap:10px;font-size:20px;font-weight:600}.flow-source-project{font-size:11px;font-weight:400;background:var(--pl-wash);border:1px solid var(--pl-line);border-radius:6px;padding:3px 8px;overflow-wrap:anywhere}.flow-source-header p{margin-bottom:0}
.flow-source-manager .flow-source-install-action{display:flex;align-items:center;justify-content:center;gap:8px;background:var(--pl-accent)!important;color:var(--pl-panel)!important;border-color:var(--pl-accent)!important}
.flow-source-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);border-top:1px solid var(--pl-line);min-width:0}
.flow-source-browser{padding:18px;min-width:0;border-right:1px solid var(--pl-line)}.flow-source-search{width:100%;margin:0 0 20px}.flow-source-group+.flow-source-group{margin-top:22px}.flow-source-group h3{display:flex;align-items:center;gap:8px;margin:0 0 10px;font-weight:600}.flow-source-count{font-size:10px;font-weight:400;line-height:1.5;color:var(--pl-soft);background:var(--pl-wash);border:1px solid var(--pl-line);border-radius:5px;padding:1px 6px;font-variant-numeric:tabular-nums}
.flow-source-list{padding:0;margin:0;list-style:none;display:flex;flex-direction:column;gap:7px}.flow-source-list>li{display:flex;align-items:center;gap:8px;padding:3px 10px 3px 3px;border:1px solid var(--pl-line);border-radius:8px;min-width:0;position:relative}.flow-source-list>li.is-selected{background:var(--pl-accent-bg);border-color:color-mix(in srgb,var(--pl-accent) 45%,var(--pl-line))}.flow-source-list>li.is-selected:before{content:'';position:absolute;left:-1px;top:10px;bottom:10px;width:3px;background:var(--pl-accent);border-radius:2px}
.flow-source-manager .flow-source-select{display:flex;align-items:center;gap:12px;text-align:left;flex:1;min-width:0;padding:12px 9px;border:0!important;background:transparent!important}.flow-source-select>svg{color:var(--pl-soft)}.is-selected .flow-source-select>svg{color:var(--pl-accent)}.flow-source-label{min-width:0;display:flex;flex-direction:column;gap:4px}.flow-source-label strong{overflow-wrap:anywhere;font-weight:600;font-size:12px;line-height:1.4}.flow-source-meta{color:var(--pl-soft);font-size:10px;overflow-wrap:anywhere}.flow-source-attention{color:var(--pl-warn);font-size:10px}
.flow-source-manager .flow-source-switch{display:flex;align-items:center;justify-content:flex-start;gap:7px;padding:6px 2px;border:0!important;background:transparent!important;font-size:10px;flex-shrink:0}.flow-source-switch-track{display:inline-flex;align-items:center;width:32px;height:19px;border-radius:12px;background:var(--pl-soft);padding:2px;flex-shrink:0}.flow-source-switch-track:after{content:'';width:15px;height:15px;border-radius:50%;background:var(--pl-panel);box-shadow:0 1px 2px #0002}.flow-source-switch[aria-checked=true] .flow-source-switch-track{background:var(--pl-accent)}.flow-source-switch[aria-checked=true] .flow-source-switch-track:after{transform:translateX(13px)}
.flow-source-inspector{padding:22px;min-width:0}.flow-source-detail-header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}.flow-source-detail-header>div{min-width:0;flex:1 1 170px}.flow-source-detail-header h3{font-size:17px;font-weight:600;overflow-wrap:anywhere}.flow-source-detail-header p{margin:6px 0 0}.flow-source-description{line-height:1.65;white-space:pre-wrap;padding:8px 0}.flow-source-properties{display:grid;grid-template-columns:minmax(80px,auto) minmax(0,1fr);gap:10px 16px;padding:16px 0;margin:16px 0 0;border-top:1px solid var(--pl-line)}.flow-source-properties dt{color:var(--pl-soft)}.flow-source-properties dd{margin:0;overflow-wrap:anywhere}.flow-source-manager code{font-size:10px;overflow-wrap:anywhere;word-break:break-word}.flow-source-recognition{display:flex;flex-wrap:wrap;gap:8px 18px;padding:8px 0 16px;color:var(--pl-soft);font-size:11px}.flow-source-recognition strong{font-weight:500;color:var(--pl-text)}
.flow-source-inventory{border-top:1px solid var(--pl-line);padding-top:16px;margin-top:4px}.flow-source-inventory h4{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;margin:0 0 12px}.flow-source-inventory ul{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:7px}.flow-source-inventory li{display:flex;align-items:center;gap:12px;border:1px solid var(--pl-line);border-radius:7px;padding:10px 12px;min-width:0;overflow-wrap:anywhere}.flow-source-inventory li>svg{color:var(--pl-accent);width:16px;height:16px}.flow-source-inventory li>div{min-width:0}.flow-source-inventory strong{font-weight:500}.flow-source-inventory code{display:block;margin-top:4px;color:var(--pl-soft)}
.flow-bundle-disclosure{border-top:1px solid var(--pl-line)}.flow-bundle-install{display:grid;gap:8px;padding:6px 20px 20px;max-width:720px}.flow-bundle-install label{color:var(--pl-soft);font-size:11px}.flow-bundle-install select{font:inherit;color:inherit;background:var(--pl-panel);border:1px solid var(--pl-line);border-radius:7px;min-height:36px;padding:7px;min-width:0}.flow-bundle-install select:focus-visible{outline:2px solid var(--pl-accent);outline-offset:3px}.flow-source-install-buttons{display:flex;gap:8px;flex-wrap:wrap}.flow-source-status{padding:4px 20px}.flow-source-manager>.flow-validation{margin:12px 20px}.flow-source-empty{padding:14px 0}
@media(min-width:761px) and (max-width:1100px){.flow-source-list>li{flex-wrap:wrap;padding-right:4px}.flow-source-list>li>.flow-source-switch{margin:0 8px 8px 40px}.flow-source-meta{font-size:11px}}
@media(max-width:760px){.flow-source-list>li>.flow-source-select{flex-basis:100%}.flow-source-grid{grid-template-columns:minmax(0,1fr)}.flow-source-browser{border-right:0;border-bottom:1px solid var(--pl-line);padding:14px}.flow-source-inspector{padding:16px}.flow-source-header{padding:16px}.flow-source-header h2{font-size:18px}.flow-source-header .flow-source-install-action{width:100%}.flow-source-list>li{flex-wrap:wrap;padding-right:4px}.flow-source-list>li>.flow-source-switch{margin:0 8px 6px 40px}.flow-source-meta{font-size:11px}.flow-source-properties{grid-template-columns:minmax(0,1fr);gap:4px}.flow-source-properties dd{margin-bottom:8px}.flow-source-manager .flow-source-switch{min-height:36px}.flow-bundle-install{padding:6px 16px 16px}}
@media(prefers-reduced-motion:reduce){.flow-source-manager summary svg{transition:none}}
</style>

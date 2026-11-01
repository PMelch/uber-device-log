<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue';
import type { FlowDiagnostic, FlowSnapshot, FlowSource } from '../../shared/flow-types';
import { translate, translateMessage, type Locale } from '../i18n';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../../shared/notifications';
const props = defineProps<{ snapshot: FlowSnapshot; locale: Locale }>();
const emit = defineEmits<{ changed: [] }>();
const t = (key: MessageKey, params?: MessageParams) => translate(props.locale, key, params);
const url = ref(''), scope = ref<'global' | 'project'>(props.snapshot.context === 'project' ? 'project' : 'global');
const busy = ref<'install' | 'activation'>(), status = ref<MessageKey>(), diagnostics = ref<FlowDiagnostic[]>([]);
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
    <summary>{{ t('flowsBlueprintSources') }}</summary>
    <p>{{ t(snapshot.context === 'project' ? 'flowsContextProject' : 'flowsContextGlobal') }}</p>
    <ul class="flow-source-list">
      <li v-for="item in snapshot.sources ?? []" :key="item.id" :data-source-id="item.id">
        <div class="flow-source-heading"><strong>{{ item.name }}</strong><span>{{ t(item.scope === 'global' ? 'flowsScopeGlobal' : 'flowsScopeProject') }} · {{ t(item.kind === 'bundle' ? 'flowsSourceBundle' : 'flowsSourceLoose') }}</span></div>
        <p v-if="item.description">{{ item.description }}</p>
        <code>{{ item.id }} · {{ item.filename }}</code>
        <p><span v-if="item.specVersion">{{ t('flowsSourceVersion', { version: String(item.specVersion) }) }} · </span>{{ t('flowsSourceActive', { count: item.activeBlueprintIds.length }) }}</p>
        <button v-if="item.kind === 'bundle'" type="button" role="switch" :aria-checked="item.enabled" :aria-label="t(item.enabled ? 'flowsBundleDisableLabel' : 'flowsBundleEnableLabel', { name: item.name })" :disabled="!!busy || !item.enabled && !!item.diagnostics.length" @click="toggle(item)">{{ t(item.enabled ? 'flowsBundleDisable' : 'flowsBundleEnable') }}</button>
        <ul v-if="item.diagnostics.length" class="flow-validation"><li v-for="(diagnostic,index) in item.diagnostics" :key="index">{{ translateMessage(locale,diagnostic) }}</li></ul>
      </li>
    </ul>
    <form class="flow-bundle-install" :aria-busy="busy === 'install'" @submit.prevent="request('install', { url, scope })">
      <h3>{{ t('flowsInstallTitle') }}</h3>
      <label for="flow-bundle-url">{{ t('flowsBundleUrl') }}</label><input id="flow-bundle-url" v-model="url" type="url" required :disabled="!!busy" aria-describedby="flow-bundle-help">
      <label for="flow-bundle-scope">{{ t('flowsBundleTarget') }}</label><select id="flow-bundle-scope" v-model="scope" :disabled="!!busy"><option value="global">{{ t('flowsScopeGlobal') }}</option><option value="project" :disabled="snapshot.context !== 'project'">{{ t('flowsScopeProject') }}</option></select>
      <p id="flow-bundle-help">{{ t('flowsBundleHelp') }}</p>
      <div><button type="submit" :disabled="!!busy">{{ t('flowsBundleInstall') }}</button> <button v-if="busy === 'install'" type="button" @click="controller?.abort()">{{ t('flowsBundleCancel') }}</button></div>
    </form>
    <p v-if="status" role="status">{{ t(status) }}</p>
    <ul v-if="diagnostics.length" role="status" class="flow-validation"><li v-for="(diagnostic,index) in diagnostics" :key="index">{{ translateMessage(locale,diagnostic) }}</li></ul>
  </details>
</template>
<style scoped>
.flow-source-manager{border:1px solid var(--pl-line);border-radius:8px;padding:12px;margin:0 0 16px;background:var(--pl-panel);min-width:0}.flow-source-manager summary{cursor:pointer;min-height:24px}.flow-source-list{padding:0;list-style:none;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:12px}.flow-source-list>li{padding:12px;border:1px solid var(--pl-line);border-radius:7px;min-width:0;overflow-wrap:anywhere}.flow-source-heading{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px}.flow-source-heading span{color:var(--pl-soft)}code{overflow-wrap:anywhere;word-break:break-word}.flow-bundle-install{display:grid;gap:8px;max-width:620px}.flow-bundle-install select{font:inherit;color:inherit;background:var(--pl-panel);border:1px solid var(--pl-line);border-radius:7px;min-height:36px;padding:7px;min-width:0}.flow-bundle-install select:focus-visible{outline:2px solid var(--pl-accent);outline-offset:3px}
</style>

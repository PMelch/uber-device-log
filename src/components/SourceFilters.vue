<script setup lang="ts">
import { computed, ref, useId } from 'vue';
import FeatureStatusBadge from './FeatureStatusBadge.vue';
import { featureStatuses, featureStatusCopy } from '../feature-status';
import type { LogSourceMetadata } from '../../shared/types';
import type { SourceFilter } from '../../shared/log-sources';
import { isLogPidFilterValid, logLevels, type LogLevel } from '../../shared/log-view';
import type { MessageParams } from '../../shared/notifications';
import type { MessageKey } from '../i18n/en';
import PrecisionMenu from './PrecisionMenu.vue';
import { consoleContextLabels, consoleContextTreeLabel, webViewLabel } from '../webview-label';
import OverlayPanel from './OverlayPanel.vue';
import InspectorAction from './InspectorAction.vue';
import ProcessSearch from './ProcessSearch.vue';
const statusBadge = ref<InstanceType<typeof FeatureStatusBadge>>();
const consoleDescriptionId = useId();
const consoleStatus = featureStatuses.javascriptConsole;
const props = defineProps<{
  messageContexts?: import('../../shared/console').ConsoleContext[];
  observed?: import('../../shared/types').AndroidProcess[];
  source: LogSourceMetadata;
  deviceName?: string;
  modelValue: SourceFilter;
  t: (key: MessageKey, params?: MessageParams) => string;
  levelLabel: (level: string) => string;
}>();
const displayName = computed(() => props.source.kind === 'postMessage' ? props.t('messageTitle') : props.source.webview ? webViewLabel(props.source.webview).name || props.t('webviewConsole') : props.source.name.replace(/^model:\s*/, ''));
const emit = defineEmits<{ 'update:modelValue': [value: SourceFilter]; 'console': []; 'captureTarget': [target: HTMLElement | undefined] }>();
const update = (patch: Partial<SourceFilter>) => emit('update:modelValue', { ...props.modelValue, ...patch });
const invalidPid = computed(() => !isLogPidFilterValid(props.modelValue.pid));
const nativeIos = computed(() => props.source.platform === 'ios' && !props.source.webview);
const supportsLevels = computed(() => !nativeIos.value && props.source.kind !== 'postMessage');
const nativeAndroid = computed(() => props.source.platform === 'android' && !props.source.webview);
const id = computed(() => `source-${encodeURIComponent(props.source.key)}`);
const messageLabels = computed(() => consoleContextLabels(props.messageContexts ?? []));
const messageContextLabel = (key: string) => messageLabels.value.get(key) ?? key;
function captureTarget(element: unknown) { emit('captureTarget', element instanceof HTMLElement ? element : undefined); }
const activeCount = computed(() => Number(props.source.kind === 'postMessage' && !!props.modelValue.messageContext) + Number(!!props.modelValue.text) + Number(nativeAndroid.value && !!props.modelValue.tag) + Number((nativeAndroid.value || nativeIos.value) && !!props.modelValue.pid) + Number(nativeIos.value && !!props.modelValue.processName) + Number(supportsLevels.value && props.modelValue.levels.length !== logLevels.length));
const active = computed(() => activeCount.value > 0);
const summary = computed(() => {
  const filter = props.modelValue;
  const items: string[] = [];
  if (filter.text) items.push(props.t(filter.mode === 'fuzzy' ? 'filterSummaryFuzzy' : 'filterSummaryLiteral', { value: filter.text }));
  if (nativeIos.value && filter.processName) items.push(filter.processName);
  if (nativeAndroid.value && filter.tag) items.push(props.t('filterSummaryTag', { value: filter.tag }));
  if ((nativeAndroid.value || nativeIos.value) && filter.pid) items.push(props.t('filterSummaryPid', { value: filter.pid }));
  if (supportsLevels.value && filter.levels.length !== logLevels.length) {
    const levels = logLevels.filter(level => filter.levels.includes(level));
    items.unshift(levels.length ? props.t('filterSummaryLevels', { value: levels.map(props.levelLabel).join(', ') }) : props.t('filterSummaryNoLevels'));
  }
  if (supportsLevels.value && filter.levels.length === logLevels.length) items.unshift(props.t('filterSummaryAllLevels'));
  if (props.source.kind === 'postMessage') {
    items.unshift(filter.messageContext ? messageContextLabel(filter.messageContext) : props.t('messageAllContexts'));
    if (filter.messageContext) items.push(props.t(filter.messageDirection === 'in' ? 'messageIncoming' : filter.messageDirection === 'out' ? 'messageOutgoing' : 'messageBoth'));
  }
  return items;
});
function toggle(level: LogLevel) {
  update({ levels: props.modelValue.levels.includes(level) ? props.modelValue.levels.filter(value => value !== level) : [...props.modelValue.levels, level] });
}
function input(event: Event) { return (event.target as HTMLInputElement).value; }
</script>

<template>
  <section class="source-filters" :aria-label="t('sourceFilterPanel', { source: displayName })">
    <div class="source-filter-main">
      <span class="source-filter-name" :title="displayName"><span class="precision-platform" :class="source.webview ? 'precision-web' : `precision-${source.platform}`" aria-hidden="true"></span><span class="source-filter-title">{{ displayName }}</span></span>
      <FeatureStatusBadge v-if="source.kind === 'postMessage'" :status="featureStatuses.postMessageLog" :t="t" />
      <span v-if="summary.length" class="source-filter-summary" role="group" :title="summary.join(' · ')" :aria-label="summary.join(' · ')"><span v-for="item in summary" :key="item" class="source-filter-chip" aria-hidden="true">{{ item }}</span></span>
      <button v-if="source.webview && !source.kind" class="source-console-button" :aria-label="consoleStatus ? t('featureStatusLabel', { feature: t('consoleTitle'), status: t(featureStatusCopy[consoleStatus].label) }) : t('consoleTitle')" :aria-describedby="consoleStatus ? consoleDescriptionId : undefined" @keydown.esc.stop.prevent="statusBadge?.hide()" @focus="statusBadge?.show()" @blur="statusBadge?.hide()" @pointerenter="statusBadge?.show()" @pointerleave="statusBadge?.hide()" @click="statusBadge?.hide(); emit('console')"><span aria-hidden="true">&gt;_</span><FeatureStatusBadge ref="statusBadge" :status="consoleStatus" :t="t" passive :description-id="consoleDescriptionId" /></button>
      <InspectorAction v-if="source.webview && !source.kind" :source="source" :device-name="deviceName" :t="t" compact />
      <OverlayPanel panel-class="source-filter-panel" :label="t('sourceFilterPanel', { source: displayName })">
        <template #trigger><span :class="{ 'source-filter-active': active }">{{ active ? t('activeFilters', { count: activeCount }) : t('filters') }}</span><span aria-hidden="true">⌄</span></template>
        <template #default="{ close }">
        <header class="overlay-heading"><strong>{{ t('sourceFilterPanel', { source: displayName }) }}</strong><button type="button" class="precision-action" :aria-label="t('closeFilters')" @click="close(true)">×</button></header>
      <div v-if="source.kind === 'postMessage'" class="source-message-filters">
        <label :for="`${id}-context`">{{ t('messageContext') }}</label>
        <select :id="`${id}-context`" :value="modelValue.messageContext || ''" @change="update({ messageContext: input($event) })">
          <option value="">{{ t('messageAllContexts') }}</option>
          <option v-for="context in messageContexts" :key="context.key" :value="context.key" :title="context.url">{{ consoleContextTreeLabel(context, messageContextLabel(context.key)) }}</option>
        </select>
        <label :for="`${id}-direction`">{{ t('messageDirection') }}</label>
        <select :id="`${id}-direction`" :value="modelValue.messageDirection || 'both'" :disabled="!modelValue.messageContext" @change="update({ messageDirection: input($event) as 'both' | 'in' | 'out' })">
          <option value="both">{{ t('messageBoth') }}</option><option value="in">{{ t('messageIncoming') }}</option><option value="out">{{ t('messageOutgoing') }}</option>
        </select>
      </div>
      <div class="precision-searchbar source-search">
        <svg class="source-search-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/></svg>
        <input :value="modelValue.text" type="search" :aria-label="t('sourceFilter', { source: displayName })" :placeholder="t('searchPlaceholder')" @input="update({ text: input($event) })" @keydown.esc="update({ text: '' })" />
      </div>
      <div class="source-search-options">
        <PrecisionMenu :label="t('searchMode')">
          <template #selected>{{ t(modelValue.mode === 'fuzzy' ? 'approximateSearch' : 'literalSearch') }}</template>
          <button :aria-pressed="modelValue.mode === 'fuzzy'" @click="update({ mode: 'fuzzy' })">{{ t('approximateSearch') }}</button>
          <button :aria-pressed="modelValue.mode === 'literal'" @click="update({ mode: 'literal' })">{{ t('literalSearch') }}</button>
        </PrecisionMenu>
        <button v-if="modelValue.text" class="precision-searchclear" @click="update({ text: '' })">{{ t('clearFilter') }}</button>
      </div>

    <details v-if="nativeAndroid || nativeIos" class="source-advanced" :open="nativeIos">
      <summary>{{ t('advancedSourceFilters') }}</summary>
      <div class="precision-metadata-filters source-metadata">
      <div v-if="nativeAndroid" class="precision-field"><label :for="`${id}-tag`">{{ t('tagFilter') }}</label><input :id="`${id}-tag`" :value="modelValue.tag" :aria-describedby="`${id}-hint`" type="text" spellcheck="false" @input="update({ tag: input($event) })" @keydown.esc="update({ tag: '' })" /></div>
      <div v-if="nativeIos" class="precision-field"><label :for="`${id}-process`">{{ t('iosProcessName') }}</label><div class="source-pid-control"><input :id="`${id}-process`" :value="modelValue.processName || ''" type="text" spellcheck="false" @input="update({ processName: input($event) })" @keydown.esc="update({ processName: '' })" /><ProcessSearch :observed="observed ?? []" :device-name="deviceName || displayName" :device-id="source.deviceId" :t="t" @select-name="update({ processName: $event, pid: '' })" /></div></div>
      <div class="precision-field"><label :for="`${id}-pid`">{{ t(nativeIos ? 'iosProcessPid' : 'pidFilter') }}</label><div class="source-pid-control"><input :id="`${id}-pid`" :value="modelValue.pid" :aria-invalid="invalidPid" :aria-describedby="invalidPid ? `${id}-error ${id}-hint` : `${id}-hint`" type="text" inputmode="numeric" @input="update({ pid: input($event) })" @keydown.esc="update({ pid: '' })" />
      <ProcessSearch v-if="nativeAndroid" :device-name="deviceName || displayName" :device-id="source.deviceId" :t="t" @select="update({ pid: $event })" />
      </div></div>
      <p :id="`${id}-hint`">{{ t(nativeIos ? 'iosProcessHint' : 'metadataFilterHint') }}</p>
      <p v-if="invalidPid" :id="`${id}-error`" class="precision-filter-error" role="status">{{ t('pidFilterInvalid') }}</p>
    </div>
    </details>
    <div v-if="supportsLevels" class="precision-severitybar source-levels" role="group" :aria-label="t('sourceLevels', { source: displayName })">
      <span class="precision-severitylabel">{{ t('levels') }}</span>
      <button class="precision-severity" :aria-pressed="modelValue.levels.length === logLevels.length" @click="update({ levels: [...logLevels] })">{{ t('all') }}</button>
      <button v-for="level in logLevels" :key="level" class="precision-severity" :data-severity="level" :aria-pressed="modelValue.levels.includes(level)" @click="toggle(level)"><span class="precision-check">✓</span>{{ levelLabel(level) }}</button>
    </div>
      <footer class="source-filter-footer">
      <button class="precision-action" :disabled="!active" @click="update({ text: '', tag: '', pid: '', processName: '', messageContext: '', messageDirection: 'both', levels: [...logLevels] })"><svg class="source-reset-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 7a6.5 6.5 0 1 1-.4 5M4 3v4h4"/></svg><span>{{ t('resetLogFilters') }}</span></button>
      </footer>
      <div v-if="source.kind === 'postMessage'" :ref="captureTarget" class="source-message-capture"></div>
        </template>
      </OverlayPanel>
    </div>
  </section>
</template>

<style scoped>
.source-message-filters { display: grid; gap: 6px; margin-bottom: 14px; }
.source-message-filters label { font-size: 12px; color: var(--pl-soft); }
.source-message-filters select { width: 100%; min-width: 0; padding: 8px; color: var(--pl-text); background: var(--pl-panel); border: 1px solid var(--pl-line); border-radius: 7px; }
.source-message-capture { margin-top: 12px; border-top: 1px solid var(--pl-line); }

#precision-design .source-console-button { flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-width: 36px; height: 36px; padding: 0 7px; border: 1px solid var(--pl-line); border-radius: 7px; background: var(--pl-panel); color: var(--pl-accent); font: 600 14px monospace; cursor: pointer; }
#precision-design .source-filters { margin: 6px 8px; padding: 4px 10px; border: 1px solid color-mix(in srgb, var(--pl-text) 22%, var(--pl-panel)); border-radius: 9px; background: color-mix(in srgb, var(--pl-text) 6%, var(--pl-panel)); box-shadow: 0 1px 2px #0000000a; min-width: 0; }
.source-filter-main { display: flex; align-items: center; justify-content: space-between; gap: 10px; height: 48px; }
.source-filter-name { display: flex; align-items: center; gap: 8px; min-width: 0; overflow: hidden; white-space: nowrap; font-size: 12px; font-weight: 600; }
.source-filter-name { flex: 0 1 auto; max-width: 30%; }
.source-filter-title { overflow: hidden; text-overflow: ellipsis; }
.source-filter-main:not(:has(.source-filter-summary)) .source-filter-name { flex: 1; max-width: none; }
.source-filter-summary { display: flex; align-items: center; gap: 5px; flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; }
.source-filter-chip { flex: 0 0 auto; max-width: 200px; min-width: 0; overflow: hidden; text-overflow: ellipsis; padding: 3px 7px; border-radius: 5px; background: var(--pl-panel); border: 1px solid var(--pl-line); color: var(--pl-soft); font-size: 11px; }
.source-filter-name .precision-platform { flex: 0 0 18px; }
.source-filter-active { color: var(--pl-accent); }
@media(max-width:700px) { #precision-design .source-filter-main :deep(> .overlay-trigger) { width: auto; max-width: 42%; } .source-filter-main { gap: 6px; } }
#precision-design .source-filters :deep(.source-filter-panel) { padding:20px; border-radius:16px; }
#precision-design .source-filters .overlay-heading { margin:0 0 18px; gap:12px; }
#precision-design .source-filters .overlay-heading strong { font-size:15px; line-height:1.4; }
#precision-design .source-filters .overlay-heading button { min-width:32px; min-height:32px; padding:0; border:0; background:transparent; box-shadow:none; color:var(--pl-soft); }
#precision-design .source-search { display:flex; flex-wrap:nowrap; padding:0 12px; gap:10px; min-width:0; height:42px; border:1px solid var(--pl-line); background:var(--pl-wash); border-radius:9px; margin:0; }
#precision-design .source-search:focus-within { border-color:var(--pl-accent); box-shadow:0 0 0 3px color-mix(in srgb,var(--pl-accent) 12%,transparent); }
#precision-design .source-search .source-search-icon { width:18px; height:18px; flex-shrink:0; color:var(--pl-soft); }
#precision-design .source-search input { flex:1; min-width:0; width:100%; padding:0; border:0; outline:none; box-shadow:none; background:transparent; font-size:13px; }
#precision-design .source-search-options { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:8px 0 16px; }
#precision-design .source-search-options :deep(summary) { min-height:30px; padding:4px 8px; border:0; border-radius:6px; background:transparent; box-shadow:none; font-size:11px; color:var(--pl-soft); }
#precision-design .source-search-options :deep(summary:hover) { background:var(--pl-wash); }
#precision-design .source-search-options .precision-searchclear { padding:4px 8px; font-size:11px; white-space:normal; }
#precision-design .source-advanced { margin:0; border-top:1px solid var(--pl-line); }
#precision-design .source-advanced > summary { display:flex; align-items:center; gap:8px; min-height:42px; padding:10px 0; border:0; border-radius:0; background:transparent; box-shadow:none; font-size:12px; font-weight:600; white-space:normal; }
#precision-design .source-advanced > summary::before { content:'▸'; display:inline-block; color:var(--pl-soft); transition:transform 160ms ease; }
#precision-design .source-advanced[open] > summary::before { transform:rotate(90deg); }
#precision-design .source-metadata { display:grid; grid-template-columns:minmax(0,1fr); gap:12px; padding:0 0 16px; margin:0; border:0; }
#precision-design .source-metadata .precision-field { display:block; min-width:0; }
#precision-design .source-metadata label { display:block; margin:0 0 6px; font-size:11px; font-weight:500; color:var(--pl-soft); }
#precision-design .source-metadata input { box-sizing:border-box; width:100%; min-width:0; height:38px; padding:8px 10px; border:1px solid var(--pl-line); border-radius:8px; background:var(--pl-panel); color:var(--pl-text); font-size:13px; }
#precision-design .source-metadata input[aria-invalid=true] { border-color:var(--pl-error); }
#precision-design .source-pid-control { display:flex; align-items:center; gap:8px; min-width:0; }
#precision-design .source-pid-control > input { flex:1; min-width:0; width:0; }
#precision-design .source-pid-control > :deep(.precision-action) { flex-shrink:0; min-height:38px; padding:8px 12px; border:1px solid var(--pl-line); border-radius:8px; background:var(--pl-wash); color:var(--pl-accent); font-size:12px; }
#precision-design .source-metadata > p { margin:0; font-size:11px; line-height:1.5; color:var(--pl-soft); }
#precision-design .source-metadata > .precision-filter-error { color:var(--pl-error); }
#precision-design .source-levels { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; padding:14px 0 16px; border-top:1px solid var(--pl-line); border-bottom:0; margin:0; }
#precision-design .source-levels .precision-severitylabel { grid-column:span 2; font-size:12px; font-weight:600; color:var(--pl-text); align-self:center; }
#precision-design .source-levels .precision-severity { min-width:0; min-height:32px; display:flex; align-items:center; justify-content:center; gap:4px; padding:6px; white-space:normal; overflow-wrap:anywhere; border-radius:7px; font:11px/1.4 system-ui,sans-serif; }
#precision-design .source-filter-footer { border-top:1px solid var(--pl-line); padding:12px 0 0; display:flex; justify-content:flex-end; }
#precision-design .source-filter-footer .precision-action { display:inline-flex; align-items:center; justify-content:center; gap:6px; min-height:34px; padding:6px 10px; font-size:11px; color:var(--pl-soft); border:1px solid var(--pl-line); border-radius:7px; background:var(--pl-panel); }
#precision-design .source-reset-icon { width:15px; height:15px; flex-shrink:0; }
#precision-design .source-filter-footer .precision-action:not(:disabled):hover { color:var(--pl-text); background:var(--pl-wash); }
@media(max-width:600px) {
  #precision-design .source-filters :deep(.source-filter-panel) { padding:16px; }
  #precision-design .source-search input,#precision-design .source-metadata input { font-size:16px; }
}
@media(pointer:coarse) {
  #precision-design .source-filters .overlay-heading button,#precision-design .source-search-options :deep(summary),#precision-design .source-search-options .precision-searchclear,#precision-design .source-levels .precision-severity,#precision-design .source-filter-footer .precision-action,#precision-design .source-pid-control > :deep(.precision-action) { min-height:44px; }
  #precision-design .source-filters .overlay-heading button { min-width:44px; }
}
@media(prefers-reduced-motion:reduce) { #precision-design .source-advanced > summary::before { transition:none; } }
</style>

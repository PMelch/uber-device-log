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
import { webViewLabel } from '../webview-label';
import OverlayPanel from './OverlayPanel.vue';
const statusBadge = ref<InstanceType<typeof FeatureStatusBadge>>();
const consoleDescriptionId = useId();
const consoleStatus = featureStatuses.javascriptConsole;
const props = defineProps<{
  source: LogSourceMetadata;
  modelValue: SourceFilter;
  t: (key: MessageKey, params?: MessageParams) => string;
  levelLabel: (level: string) => string;
}>();
const displayName = computed(() => props.source.webview ? webViewLabel(props.source.webview).name || props.t('webviewConsole') : props.source.name.replace(/^model:\s*/, ''));
const emit = defineEmits<{ 'update:modelValue': [value: SourceFilter]; 'console': [] }>();
const update = (patch: Partial<SourceFilter>) => emit('update:modelValue', { ...props.modelValue, ...patch });
const invalidPid = computed(() => !isLogPidFilterValid(props.modelValue.pid));
const nativeIos = computed(() => props.source.platform === 'ios' && !props.source.webview);
const nativeAndroid = computed(() => props.source.platform === 'android' && !props.source.webview);
const id = computed(() => `source-${encodeURIComponent(props.source.key)}`);
const activeCount = computed(() => Number(!!props.modelValue.text) + Number(nativeAndroid.value && !!props.modelValue.tag) + Number(nativeAndroid.value && !!props.modelValue.pid) + Number(!nativeIos.value && props.modelValue.levels.length !== logLevels.length));
const active = computed(() => activeCount.value > 0);
const summary = computed(() => {
  const filter = props.modelValue;
  const items: string[] = [];
  if (filter.text) items.push(props.t(filter.mode === 'fuzzy' ? 'filterSummaryFuzzy' : 'filterSummaryLiteral', { value: filter.text }));
  if (nativeAndroid.value && filter.tag) items.push(props.t('filterSummaryTag', { value: filter.tag }));
  if (nativeAndroid.value && filter.pid) items.push(props.t('filterSummaryPid', { value: filter.pid }));
  if (!nativeIos.value && filter.levels.length !== logLevels.length) {
    const levels = logLevels.filter(level => filter.levels.includes(level));
    items.unshift(levels.length ? props.t('filterSummaryLevels', { value: levels.map(props.levelLabel).join(', ') }) : props.t('filterSummaryNoLevels'));
  }
  if (!nativeIos.value && filter.levels.length === logLevels.length) items.unshift(props.t('filterSummaryAllLevels'));
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
      <span v-if="summary.length" class="source-filter-summary" role="group" :title="summary.join(' · ')" :aria-label="summary.join(' · ')"><span v-for="item in summary" :key="item" class="source-filter-chip" aria-hidden="true">{{ item }}</span></span>
      <button v-if="source.webview" class="source-console-button" :aria-label="consoleStatus ? t('featureStatusLabel', { feature: t('consoleTitle'), status: t(featureStatusCopy[consoleStatus].label) }) : t('consoleTitle')" :aria-describedby="consoleStatus ? consoleDescriptionId : undefined" @keydown.esc.stop.prevent="statusBadge?.hide()" @focus="statusBadge?.show()" @blur="statusBadge?.hide()" @pointerenter="statusBadge?.show()" @pointerleave="statusBadge?.hide()" @click="statusBadge?.hide(); emit('console')"><span aria-hidden="true">&gt;_</span><FeatureStatusBadge ref="statusBadge" :status="consoleStatus" :t="t" passive :description-id="consoleDescriptionId" /></button>
      <OverlayPanel :label="t('sourceFilterPanel', { source: displayName })">
        <template #trigger><span :class="{ 'source-filter-active': active }">{{ active ? t('activeFilters', { count: activeCount }) : t('filters') }}</span><span aria-hidden="true">⌄</span></template>
        <template #default="{ close }">
        <header class="overlay-heading"><strong>{{ t('sourceFilterPanel', { source: displayName }) }}</strong><button type="button" class="precision-action" :aria-label="t('closeFilters')" @click="close(true)">×</button></header>
      <div class="precision-searchbar source-search">
        <span aria-hidden="true">⌕</span>
        <input :value="modelValue.text" type="search" :aria-label="t('sourceFilter', { source: displayName })" :placeholder="t('searchPlaceholder')" @input="update({ text: input($event) })" @keydown.esc="update({ text: '' })" />
        <PrecisionMenu :label="t('searchMode')">
          <template #selected>{{ t(modelValue.mode === 'fuzzy' ? 'approximateSearch' : 'literalSearch') }}</template>
          <button :aria-pressed="modelValue.mode === 'fuzzy'" @click="update({ mode: 'fuzzy' })">{{ t('approximateSearch') }}</button>
          <button :aria-pressed="modelValue.mode === 'literal'" @click="update({ mode: 'literal' })">{{ t('literalSearch') }}</button>
        </PrecisionMenu>
        <button v-if="modelValue.text" class="precision-searchclear" @click="update({ text: '' })">{{ t('clearFilter') }}</button>
      </div>
      <button class="precision-action" :disabled="!active" @click="update({ text: '', tag: '', pid: '', levels: [...logLevels] })">{{ t('resetLogFilters') }}</button>
    <details v-if="nativeAndroid" class="source-advanced">
      <summary>{{ t('advancedSourceFilters') }}</summary>
      <div class="precision-metadata-filters source-metadata">
      <div class="precision-field"><label :for="`${id}-tag`">{{ t('tagFilter') }}</label><input :id="`${id}-tag`" :value="modelValue.tag" :aria-describedby="`${id}-hint`" type="text" spellcheck="false" @input="update({ tag: input($event) })" @keydown.esc="update({ tag: '' })" /></div>
      <div class="precision-field"><label :for="`${id}-pid`">{{ t('pidFilter') }}</label><input :id="`${id}-pid`" :value="modelValue.pid" :aria-invalid="invalidPid" :aria-describedby="invalidPid ? `${id}-error ${id}-hint` : `${id}-hint`" type="text" inputmode="numeric" @input="update({ pid: input($event) })" @keydown.esc="update({ pid: '' })" /></div>
      <p :id="`${id}-hint`">{{ t('metadataFilterHint') }}</p>
      <p v-if="invalidPid" :id="`${id}-error`" class="precision-filter-error" role="status">{{ t('pidFilterInvalid') }}</p>
    </div>
    </details>
    <div class="precision-severitybar source-levels" role="group" :aria-label="t('sourceLevels', { source: displayName })" :aria-describedby="nativeIos ? `${id}-ios` : undefined">
      <span class="precision-severitylabel">{{ t('levels') }}</span>
      <button class="precision-severity" :disabled="nativeIos" :aria-pressed="!nativeIos && modelValue.levels.length === logLevels.length" @click="update({ levels: [...logLevels] })">{{ t('all') }}</button>
      <button v-for="level in logLevels" :key="level" class="precision-severity" :data-severity="level" :disabled="nativeIos" :aria-pressed="!nativeIos && modelValue.levels.includes(level)" @click="toggle(level)"><span class="precision-check">✓</span>{{ levelLabel(level) }}</button>
      <span v-if="nativeIos" :id="`${id}-ios`" class="precision-ios-note">{{ t('iosNote') }}</span>
    </div>
        </template>
      </OverlayPanel>
    </div>
  </section>
</template>

<style scoped>
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
#precision-design .source-search { padding: 8px; gap: 8px; min-width: 0; border: 1px solid var(--pl-line); background: var(--pl-panel); border-radius: 8px; margin-bottom: 8px; }
#precision-design .source-search input { flex: 1 1 180px; width: 100%; }
#precision-design .source-search :deep(summary) { min-height: 36px; padding: 6px 8px; font-size: 12px; }
#precision-design .source-metadata input { background: var(--pl-panel); border-color: var(--pl-line); }
#precision-design .source-metadata input[aria-invalid=true] { border-color: var(--pl-error); }
.source-advanced { margin-top: 8px; }
#precision-design .source-advanced > summary { min-height: 40px; padding: 6px; border: 0; background: none; font-size: 12px; white-space: normal; }
.source-advanced > summary::before { content: '▸'; display: inline-block; transition: transform 160ms ease; }
.source-advanced[open] > summary::before { transform: rotate(90deg); }
.source-metadata { margin-top: 4px; }
#precision-design .source-levels { padding: 10px 0 0; border-bottom: 0; flex-wrap: wrap; margin-top: 4px; }
@media(prefers-reduced-motion:reduce) { .source-advanced > summary::before { transition: none; } }
</style>

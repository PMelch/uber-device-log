<script setup lang="ts">
import { computed } from 'vue';
import type { LogSourceMetadata } from '../../shared/types';
import type { SourceFilter } from '../../shared/log-sources';
import { isLogPidFilterValid, logLevels, type LogLevel } from '../../shared/log-view';
import type { MessageParams } from '../../shared/notifications';
import type { MessageKey } from '../i18n/en';
import PrecisionMenu from './PrecisionMenu.vue';
import OverlayPanel from './OverlayPanel.vue';
const props = defineProps<{
  source: LogSourceMetadata;
  modelValue: SourceFilter;
  t: (key: MessageKey, params?: MessageParams) => string;
  levelLabel: (level: string) => string;
}>();
const displayName = computed(() => props.source.webview ? props.source.name : props.source.name.replace(/^model:\s*/, ''));
const emit = defineEmits<{ 'update:modelValue': [value: SourceFilter] }>();
const update = (patch: Partial<SourceFilter>) => emit('update:modelValue', { ...props.modelValue, ...patch });
const invalidPid = computed(() => !isLogPidFilterValid(props.modelValue.pid));
const nativeIos = computed(() => props.source.platform === 'ios' && !props.source.webview);
const nativeAndroid = computed(() => props.source.platform === 'android' && !props.source.webview);
const id = computed(() => `source-${encodeURIComponent(props.source.key)}`);
const activeCount = computed(() => Number(!!props.modelValue.text) + Number(nativeAndroid.value && !!props.modelValue.tag) + Number(nativeAndroid.value && !!props.modelValue.pid) + Number(!nativeIos.value && props.modelValue.levels.length !== logLevels.length));
const active = computed(() => activeCount.value > 0);
function toggle(level: LogLevel) {
  update({ levels: props.modelValue.levels.includes(level) ? props.modelValue.levels.filter(value => value !== level) : [...props.modelValue.levels, level] });
}
function input(event: Event) { return (event.target as HTMLInputElement).value; }
</script>

<template>
  <section class="source-filters" :aria-label="t('sourceFilterPanel', { source: displayName })">
    <div class="source-filter-main">
      <span class="source-filter-name" :title="displayName"><span class="precision-platform" :class="source.webview ? 'precision-web' : `precision-${source.platform}`" aria-hidden="true"></span>{{ displayName }}</span>
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
#precision-design .source-filters { margin: 6px 8px; padding: 4px 10px; border: 1px solid var(--pl-line); border-radius: 9px; background: var(--pl-panel); min-width: 0; }
.source-filter-main { display: flex; align-items: center; justify-content: space-between; gap: 10px; height: 48px; }
.source-filter-name { display: flex; align-items: center; gap: 8px; min-width: 0; overflow: hidden; white-space: nowrap; font-size: 12px; }
.source-filter-name .precision-platform { flex: 0 0 18px; }
.source-filter-active { color: var(--pl-accent); }
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

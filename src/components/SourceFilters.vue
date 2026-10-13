<script setup lang="ts">
import { computed } from 'vue';
import type { LogSourceMetadata } from '../../shared/types';
import type { SourceFilter } from '../../shared/log-sources';
import { isLogPidFilterValid, logLevels, type LogLevel } from '../../shared/log-view';
import type { MessageParams } from '../../shared/notifications';
import type { MessageKey } from '../i18n/en';
import PrecisionMenu from './PrecisionMenu.vue';
const props = defineProps<{
  source: LogSourceMetadata;
  modelValue: SourceFilter;
  t: (key: MessageKey, params?: MessageParams) => string;
  levelLabel: (level: string) => string;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: SourceFilter] }>();
const update = (patch: Partial<SourceFilter>) => emit('update:modelValue', { ...props.modelValue, ...patch });
const invalidPid = computed(() => !isLogPidFilterValid(props.modelValue.pid));
const nativeAndroid = computed(() => props.source.platform === 'android' && !props.source.webview);
const id = computed(() => `source-${encodeURIComponent(props.source.key)}`);
const active = computed(() => !!(props.modelValue.text || props.modelValue.tag || props.modelValue.pid) || props.modelValue.levels.length !== logLevels.length);
function toggle(level: LogLevel) {
  update({ levels: props.modelValue.levels.includes(level) ? props.modelValue.levels.filter(value => value !== level) : [...props.modelValue.levels, level] });
}
function input(event: Event) { return (event.target as HTMLInputElement).value; }
</script>

<template>
  <section class="source-filters" :aria-label="t('sourceFilter', { source: source.name })">
    <div class="source-filter-main">
      <span class="source-filter-name" :title="source.name"><span class="precision-platform" :class="source.webview ? 'precision-web' : `precision-${source.platform}`" aria-hidden="true"></span>{{ source.name }}</span>
      <div class="precision-searchbar source-search">
        <span aria-hidden="true">⌕</span>
        <input :value="modelValue.text" type="search" :aria-label="t('sourceFilter', { source: source.name })" :placeholder="t('searchPlaceholder')" @input="update({ text: input($event) })" @keydown.esc="update({ text: '' })" />
        <PrecisionMenu :label="t('searchMode')">
          <template #selected>{{ t(modelValue.mode === 'fuzzy' ? 'approximateSearch' : 'literalSearch') }}</template>
          <button :aria-pressed="modelValue.mode === 'fuzzy'" @click="update({ mode: 'fuzzy' })">{{ t('approximateSearch') }}</button>
          <button :aria-pressed="modelValue.mode === 'literal'" @click="update({ mode: 'literal' })">{{ t('literalSearch') }}</button>
        </PrecisionMenu>
        <button v-if="modelValue.text" class="precision-searchclear" @click="update({ text: '' })">{{ t('clearFilter') }}</button>
      </div>
      <button class="precision-action" :disabled="!active" @click="update({ text: '', tag: '', pid: '', levels: [...logLevels] })">{{ t('resetLogFilters') }}</button>
    </div>
    <div v-if="nativeAndroid" class="precision-metadata-filters source-metadata">
      <div class="precision-field"><label :for="`${id}-tag`">{{ t('tagFilter') }}</label><input :id="`${id}-tag`" :value="modelValue.tag" :aria-describedby="`${id}-hint`" type="text" spellcheck="false" @input="update({ tag: input($event) })" @keydown.esc="update({ tag: '' })" /></div>
      <div class="precision-field"><label :for="`${id}-pid`">{{ t('pidFilter') }}</label><input :id="`${id}-pid`" :value="modelValue.pid" :aria-invalid="invalidPid" :aria-describedby="invalidPid ? `${id}-error ${id}-hint` : `${id}-hint`" type="text" inputmode="numeric" @input="update({ pid: input($event) })" @keydown.esc="update({ pid: '' })" /></div>
      <p :id="`${id}-hint`">{{ t('metadataFilterHint') }}</p>
      <p v-if="invalidPid" :id="`${id}-error`" class="precision-filter-error" role="status">{{ t('pidFilterInvalid') }}</p>
    </div>
    <div class="precision-severitybar source-levels" role="group" :aria-label="t('sourceLevels', { source: source.name })" :aria-describedby="source.platform === 'ios' ? `${id}-ios` : undefined">
      <span class="precision-severitylabel">{{ t('levels') }}</span>
      <button class="precision-severity" :disabled="source.platform === 'ios'" :aria-pressed="source.platform !== 'ios' && modelValue.levels.length === logLevels.length" @click="update({ levels: [...logLevels] })">{{ t('all') }}</button>
      <button v-for="level in logLevels" :key="level" class="precision-severity" :data-severity="level" :disabled="source.platform === 'ios'" :aria-pressed="source.platform !== 'ios' && modelValue.levels.includes(level)" @click="toggle(level)"><span class="precision-check">✓</span>{{ levelLabel(level) }}</button>
      <span v-if="source.platform === 'ios'" :id="`${id}-ios`" class="precision-ios-note">{{ t('iosNote') }}</span>
    </div>
  </section>
</template>

<style scoped>
.source-filters { margin: 8px; padding: 12px; border: 1px solid color-mix(in srgb, var(--pl-accent) 20%, transparent); border-radius: 12px; background: color-mix(in srgb, var(--pl-accent) 10%, transparent); min-width: 0; }
.source-filter-main { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.source-filter-name { display: flex; align-items: center; gap: 8px; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.source-filter-name .precision-platform { flex: 0 0 18px; pointer-events: none; user-select: none; }
#precision-design .source-search { flex: 1 1 300px; min-width: 0; border: 1px solid var(--pl-line); border-radius: 8px; padding: 6px 10px; }
.source-metadata { margin-top: 8px; }
.source-levels { flex-wrap: wrap; margin-top: 8px; }
@media (max-width: 620px) { .source-filter-name { width: 100%; max-width: 100%; } .source-search { flex-basis: 100%; } }
</style>

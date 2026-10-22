<script setup lang="ts">
import { ref, watch } from 'vue';
import type { ConsoleValue, ConsoleProperties, ConsoleErrorCode } from '../../shared/console';
import type { MessageKey } from '../i18n/en';
const props = defineProps<{ value: ConsoleValue; limited: string; t: (key: MessageKey) => string;
  available: boolean; inspect: (value: ConsoleValue, offset: number) => Promise<ConsoleProperties> }>();
const details = ref<HTMLDetailsElement>();
const loading = ref(false), loaded = ref(false), nextOffset = ref<number>();
const error = ref<ConsoleErrorCode>();
let generation = 0;
watch(() => props.value, () => { generation++; loading.value = false; loaded.value = false; nextOffset.value = undefined; error.value = undefined; });
async function load() {
  if (loading.value || !props.available) return;
  const version = generation;
  loading.value = true; error.value = undefined;
  try {
    const page = await props.inspect(props.value, loaded.value ? nextOffset.value ?? 0 : 0);
    if (version !== generation) return;
    loaded.value = true; nextOffset.value = page.nextOffset;
    if (details.value) details.value.open = true;
  } catch (e) {
    if (version === generation) error.value = ['consoleStale', 'consoleTimeout', 'consoleBusy', 'consoleInvalid'].includes(String(e)) ? e as ConsoleErrorCode : 'consoleUnavailable';
  } finally { if (version === generation) loading.value = false; }
}
</script>
<template>
  <details v-if="value.children?.length || value.handle" ref="details" class="console-value">
    <summary>{{ value.text }}</summary>
    <button v-if="value.handle && !loaded" class="console-inspect" :disabled="loading || !available" @click="load">{{ t(loading ? 'consolePropertiesLoading' : 'consoleInspect') }}</button>
    <div v-for="(child, index) in value.children" :key="index" class="console-property"><code>{{ child.name }}:</code><ConsoleValue :value="child.value" :limited="limited" :t="t" :available="available" :inspect="inspect" /></div>
    <button v-if="loaded && nextOffset !== undefined" class="console-more" :disabled="loading || !available" @click="load">{{ t(loading ? 'consolePropertiesLoading' : 'consoleMoreProperties') }}</button>
    <small v-if="error" role="alert">{{ t(error) }}</small>
    <small v-if="value.truncated">{{ limited }}</small>
  </details>
  <span v-else class="console-scalar" :data-type="value.type">{{ value.text }}<small v-if="value.truncated"> · {{ limited }}</small></span>
</template>
<style scoped>
.console-value,.console-scalar { font: 12px/1.7 ui-monospace,monospace; white-space: pre-wrap; overflow-wrap: anywhere; min-width: 0; }
.console-value summary { cursor: pointer; }
.console-property { display: flex; align-items: baseline; gap: 8px; padding-left: 12px; border-left: 1px solid var(--pl-line); }
.console-property > .console-value, .console-property > .console-scalar { flex: 1; }
button { display: block; margin: 4px 0; padding: 5px 8px; border: 1px solid var(--pl-line); border-radius: 5px; background: var(--pl-panel); color: var(--pl-accent); font: inherit; cursor: pointer; white-space: normal; text-align: start; }
button:disabled { opacity: .5; cursor: default; }
button:focus-visible, summary:focus-visible { outline: 2px solid var(--pl-accent); outline-offset: 2px; }
.console-property > code { color: var(--pl-accent); }
small { color: var(--pl-soft); }
[data-type=string] { color: #228654; }
</style>

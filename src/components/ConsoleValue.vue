<script setup lang="ts">
import type { ConsoleValue } from '../../shared/console';
defineProps<{ value: ConsoleValue; limited: string }>();
</script>
<template>
  <details v-if="value.children?.length" class="console-value">
    <summary>{{ value.text }}</summary>
    <div v-for="(child, index) in value.children" :key="index" class="console-property"><code>{{ child.name }}:</code><ConsoleValue :value="child.value" :limited="limited" /></div>
    <small v-if="value.truncated">{{ limited }}</small>
  </details>
  <span v-else class="console-scalar" :data-type="value.type">{{ value.text }}<small v-if="value.truncated"> · {{ limited }}</small></span>
</template>
<style scoped>
.console-value,.console-scalar { font: 12px/1.7 ui-monospace,monospace; white-space: pre-wrap; overflow-wrap: anywhere; min-width: 0; }
.console-value summary { cursor: pointer; }
.console-property { display: flex; align-items: baseline; gap: 8px; padding-left: 12px; border-left: 1px solid var(--pl-line); }
.console-property > code { color: var(--pl-accent); }
small { color: var(--pl-soft); }
[data-type=string] { color: #228654; }
</style>

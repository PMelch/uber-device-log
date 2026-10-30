<script setup lang="ts">
import type { FlowResult } from '../../shared/flow-types';
defineProps<{ results: FlowResult[]; label: string; concealed: string; reveal?: boolean }>();
function format(value: unknown) { return typeof value === 'string' ? value : JSON.stringify(value); }
</script>

<template>
  <div v-if="results.length" class="flow-results"><span class="flow-results-heading" aria-hidden="true">{{ label }}</span><dl :aria-label="label"><div v-for="result in results" :key="result.field" class="flow-result"><dt>{{ result.field }}</dt><dd>{{ result.sensitive && !reveal ? concealed : format(result.value) }}</dd></div></dl></div>
</template>

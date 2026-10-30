<script setup lang="ts">
import type { FlowLabelPart } from '../../shared/flow-types';
defineProps<{ parts: FlowLabelPart[]; concealed: string; reveal?: boolean }>();
</script>

<template>
  <span class="flow-main-label"><span v-for="(part, index) in parts" :key="index" :class="part.tone ? `flow-label-${part.tone}` : undefined">{{ part.sensitive && !reveal ? concealed : part.text }}</span></span>
</template>

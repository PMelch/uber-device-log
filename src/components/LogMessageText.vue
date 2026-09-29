<script setup lang="ts">
import { computed } from 'vue';
import { parseLogStack } from '../../shared/log-view';

const props = defineProps<{ message: string }>();
const stack = computed(() => parseLogStack(props.message));
</script>

<template>
  <span v-if="stack" class="precision-msg precision-stack"><span v-for="(line, index) in stack" :key="index" class="precision-stack-line" :data-kind="line.kind">{{ line.text }}<span v-if="line.location" class="precision-stack-location">{{ line.location }}</span></span></span>
  <span v-else class="precision-msg">{{ message }}</span>
</template>

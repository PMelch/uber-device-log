<script setup lang="ts">
import { parseFileReadFailure } from '../../shared/log-details';
import { computed } from 'vue';
import { parseLogStack } from '../../shared/log-view';

const props = defineProps<{ message: string }>();
const fileFailure = computed(() => parseFileReadFailure(props.message));
const stack = computed(() => parseLogStack(props.message));
</script>

<template>
  <span v-if="fileFailure" class="precision-msg precision-file-failure"><span v-for="(segment, index) in fileFailure.segments" :key="index" class="precision-file-failure-line">{{ segment }}</span></span>
  <span v-else-if="stack" class="precision-msg precision-stack"><span v-for="(line, index) in stack" :key="index" class="precision-stack-line" :data-kind="line.kind">{{ line.text }}<span v-if="line.location" class="precision-stack-location">{{ line.location }}</span></span></span>
  <span v-else class="precision-msg">{{ message }}</span>
</template>

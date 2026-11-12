<script setup lang="ts">
import { computed } from 'vue';
import type { LogSource } from '../../shared/types';
import { useConsoleSession } from '../composables/useConsoleSession';
import { translate, type Locale } from '../i18n';
import PostMessageLog from './PostMessageLog.vue';

const props = defineProps<{ source: LogSource; locale: Locale; contextTarget?: HTMLElement }>();
const emit = defineEmits<{ records: [records: import('../../shared/postmessage').MessageLogRecord[]]; active: [active: boolean] }>();
const { session, state, error, connect, connecting } = useConsoleSession(computed(() => props.source));
</script>

<template>
  <div class="webview-message-session">
    <div v-if="error || (!connecting && !state.connected)" role="status">
      {{ translate(locale, error || 'consoleUnavailable') }}
      <button class="precision-action" :disabled="connecting" @click="connect">{{ translate(locale, 'reconnect') }}</button>
    </div>
    <PostMessageLog integrated @records="emit('records', $event)" @active="emit('active', $event)" :key="session" :session="session" :state="state" :locale="locale" :context-target="contextTarget" context="" />
  </div>
</template>

<style scoped>
.webview-message-session { min-width: 0;  }
</style>

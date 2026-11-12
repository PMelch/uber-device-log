<script setup lang="ts">
import { computed, watch } from 'vue';
import type { LogSource } from '../../shared/types';
import { useConsoleSession } from '../composables/useConsoleSession';
import { translate, type Locale } from '../i18n';
import PostMessageLog from './PostMessageLog.vue';

const props = defineProps<{ source: LogSource; locale: Locale; contextTarget?: HTMLElement; controlsTarget?: HTMLElement }>();
const emit = defineEmits<{ records: [records: import('../../shared/postmessage').MessageLogRecord[]]; active: [active: boolean]; contexts: [contexts: import('../../shared/console').ConsoleContext[]] }>();
const { session, state, error, connect, connecting } = useConsoleSession(computed(() => props.source));
watch(() => state.value.contexts, contexts => emit('contexts', contexts), { immediate: true });
</script>

<template>
  <Teleport :to="controlsTarget ?? 'body'" :disabled="!controlsTarget">
  <div v-show="!!controlsTarget" class="webview-message-session">
    <div v-if="error || (!connecting && !state.connected)" role="status">
      {{ translate(locale, error || 'consoleUnavailable') }}
      <button class="precision-action" :disabled="connecting" @click="connect">{{ translate(locale, 'reconnect') }}</button>
    </div>
    <PostMessageLog integrated @records="emit('records', $event)" @active="emit('active', $event)" :key="session" :session="session" :state="state" :locale="locale" :context-target="contextTarget" context="" />
  </div>
  </Teleport>
</template>

<style scoped>
.webview-message-session { min-width: 0;  }
</style>

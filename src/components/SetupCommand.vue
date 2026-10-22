<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../../shared/notifications';
const props = defineProps<{ command: string; t: (key: MessageKey, params?: MessageParams) => string }>();
const feedback = ref<'setupCopied' | 'setupCopyFailed'>();
watch(() => props.command, () => { feedback.value = undefined; });
let disposed = false;
async function copy() {
  try {
    await navigator.clipboard.writeText(props.command);
    if (!disposed) feedback.value = 'setupCopied';
  } catch { if (!disposed) feedback.value = 'setupCopyFailed'; }
}
onUnmounted(() => { disposed = true; });
</script>
<template>
  <div class="setup-command-block">
    <div class="setup-command"><pre><code>{{ command }}</code></pre><button type="button" :title="t('setupCopy')" :aria-label="t('setupCopy')" @click="copy"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg></button></div>
    <p v-if="feedback" class="setup-copy-feedback" role="status">{{ t(feedback) }}</p>
    <textarea v-if="feedback === 'setupCopyFailed'" readonly :value="command" :aria-label="t('setupManualCopy')" spellcheck="false" @focus="($event.target as HTMLTextAreaElement).select()" />
  </div>
</template>
<style scoped>
#precision-design .setup-command { display:flex; align-items:start; gap:8px; min-width:0; border:1px solid var(--pl-line); border-radius:6px; background:var(--pl-wash); margin:8px 0; padding:6px 8px 6px 12px; }
pre { flex:1; min-width:0; white-space:pre-wrap; overflow-wrap:anywhere; margin:4px 0; font:12px/1.7 ui-monospace,SFMono-Regular,Consolas,monospace; }
#precision-design .setup-command button { flex:none; display:grid; place-items:center; min-width:36px; min-height:36px; border-radius:5px; color:var(--pl-soft); }
#precision-design .setup-command button:hover { color:var(--pl-text); background:var(--pl-line); }
#precision-design .setup-copy-feedback { font-size:12px; margin:6px 0; }
textarea { display:block; width:100%; min-height:84px; padding:8px; white-space:pre-wrap; overflow-wrap:anywhere; background:var(--pl-panel); color:var(--pl-text); border:1px solid var(--pl-line); border-radius:6px; font:12px/1.6 monospace; }
textarea:focus-visible { outline:2px solid var(--pl-accent); outline-offset:2px; }
@media(pointer:coarse) { #precision-design .setup-command button { min-width:44px; min-height:44px; } textarea { font-size:16px; } }
</style>

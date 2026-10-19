<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../../shared/notifications';
import { pollForUpdate, type UpdateInfo } from '../update-check';

defineProps<{ t: (key: MessageKey, params?: MessageParams) => string }>();
const update = ref<UpdateInfo>();
const root = ref<HTMLDetailsElement>();
const trigger = ref<HTMLElement>();
function close() { if (root.value) root.value.open = false; trigger.value?.focus(); }
let stop: (() => void) | undefined;
onMounted(() => { stop = pollForUpdate(value => { update.value = value; }); });
onUnmounted(() => stop?.());
</script>

<template>
  <details v-if="update" ref="root" class="update-notice" open @keydown.esc.stop.prevent="close">
    <summary ref="trigger">{{ t('updateAvailable', { current: update.currentVersion, latest: update.latestVersion ?? '' }) }}</summary>
    <section class="update-notice-panel" :aria-label="t('updateAvailable', { current: update.currentVersion, latest: update.latestVersion ?? '' })">
      <div class="update-notice-heading">
        <strong role="status">{{ t('updateAvailable', { current: update.currentVersion, latest: update.latestVersion ?? '' }) }}</strong>
        <button type="button" :aria-label="t('updateDismiss')" @click="close">×</button>
      </div>
      <a v-if="update.changelogUrl" :href="update.changelogUrl" target="_blank" rel="noopener noreferrer">{{ t('updateChangelog') }}</a>
      <p>{{ t('updateInstructions') }}</p>
      <p v-if="update.installation === 'unknown'">{{ t('updateUnknown') }}</p>
      <pre v-for="command in update.commands" :key="command"><code>{{ command }}</code></pre>
    </section>
  </details>
</template>

<style scoped>
.update-notice { position: relative; font-size: 12px; }
#precision-design .update-notice { min-width: 0; max-width: 100%; }
#precision-design .update-notice > summary { cursor: pointer; color: var(--pl-accent); white-space: normal; overflow-wrap: anywhere; font-size: 12px; padding: 7px 10px; min-height: 36px; }
.update-notice-panel { position: absolute; right: 0; top: calc(100% + 10px); z-index: 50; width: min(420px, calc(100vw - 32px)); padding: 16px; border: 1px solid var(--pl-line); border-radius: 10px; background: var(--pl-panel); color: var(--pl-text); box-shadow: 0 8px 28px #0002; }
.update-notice-heading { display: flex; gap: 12px; align-items: start; justify-content: space-between; margin-bottom: 10px; }
a { color: var(--pl-accent); display: inline-block; margin-bottom: 10px; }
p + p, pre { margin-top: 10px !important; }
pre { overflow-wrap: anywhere; white-space: pre-wrap; padding: 10px; border-radius: 6px; background: var(--pl-bg); }
button { font-size: 18px !important; line-height: 1; }
a:focus-visible { outline: 2px solid var(--pl-accent); outline-offset: 3px; }
@media (max-width: 700px) {
  #precision-design .update-notice { flex: 1 1 100%; order: 2; }
  .update-notice-panel { position: fixed; left: 16px; right: 16px; top: 140px; width: auto; max-height: calc(100dvh - 156px); overflow: auto; }
}
</style>

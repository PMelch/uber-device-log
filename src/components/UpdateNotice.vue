<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../../shared/notifications';
import { pollForUpdate, type UpdateInfo } from '../update-check';
import { createUpdatePreference } from '../update-preference';

defineProps<{ t: (key: MessageKey, params?: MessageParams) => string }>();
const update = ref<UpdateInfo>();
const root = ref<HTMLDetailsElement>();
const trigger = ref<HTMLElement>();
function close() { if (root.value) root.value.open = false; trigger.value?.focus(); }
const preference = createUpdatePreference();
let latest: UpdateInfo | undefined;
function refresh() {
  update.value = latest?.latestVersion && !preference.isHidden(latest.latestVersion) ? latest : undefined;
}
function hide(action: 'later' | 'dismiss') {
  if (!update.value?.latestVersion) return;
  // Move keyboard focus to the next header control before removing this notice.
  const next = root.value?.parentElement?.querySelector<HTMLElement>('.precision-settings summary');
  preference.hide(update.value.latestVersion, action);
  refresh();
  next?.focus();
}
let stop: (() => void) | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  stop = pollForUpdate(value => { latest = value; refresh(); });
  timer = setInterval(refresh, 60_000);
  window.addEventListener('focus', refresh);
  window.addEventListener('storage', refresh);
  document.addEventListener('visibilitychange', refresh);
});
onUnmounted(() => {
  stop?.();
  clearInterval(timer);
  window.removeEventListener('focus', refresh);
  window.removeEventListener('storage', refresh);
  document.removeEventListener('visibilitychange', refresh);
});
</script>

<template>
  <details v-if="update" ref="root" class="update-notice" open @toggle="refresh" @keydown.esc.stop.prevent="close">
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
      <div class="update-notice-actions">
        <button type="button" :title="t('updateRemindLaterHint')" @click="hide('later')">{{ t('updateRemindLater') }}</button>
        <button type="button" @click="hide('dismiss')">{{ t('updateDismissVersion') }}</button>
      </div>
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
.update-notice-heading button { font-size: 18px !important; line-height: 1; }
.update-notice-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
.update-notice-actions button { min-height: 36px; padding: 8px 10px; font-size: 12px; line-height: 1.4; white-space: normal; border: 1px solid var(--pl-line); border-radius: 6px; }
button:focus-visible { outline: 2px solid var(--pl-accent); outline-offset: 3px; }
a:focus-visible { outline: 2px solid var(--pl-accent); outline-offset: 3px; }
@media (max-width: 700px) {
  #precision-design .update-notice { flex: 1 1 100%; order: 2; }
  .update-notice-panel { position: fixed; left: 16px; right: 16px; top: 140px; width: auto; max-height: calc(100dvh - 156px); overflow: auto; }
}
</style>

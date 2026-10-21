<script setup lang="ts">
import { ref } from 'vue';
import { useDisclosureDismissal } from '../composables/useDisclosureDismissal';
import { languages, translate, type Locale } from '../i18n';
import { bufferSizes, resolveBufferSize, resolveMessageOrder, resolveTheme, type Theme, type MessageOrder } from '../preferences';
const props = defineProps<{ locale: Locale; theme: Theme; order: MessageOrder; bufferSize: number; performance: boolean; showConnectionGuides: boolean }>();
const emit = defineEmits<{ order: [value: MessageOrder]; locale: [value: Locale]; theme: [value: Theme]; bufferSize: [value: number]; performance: [value: boolean]; connectionGuides: [value: boolean] }>();
const root = ref<HTMLDetailsElement>();
const developmentBuild = import.meta.env.DEV;
const appVersion = import.meta.env.VITE_APP_VERSION;
const trigger = ref<HTMLElement>();
defineExpose({ focus: () => trigger.value?.focus() });
const t = (key: Parameters<typeof translate>[1]) => translate(props.locale, key);
function close(focus = false) {
  if (!root.value?.open) return;
  root.value.open = false;
  if (focus) trigger.value?.focus();
}
useDisclosureDismissal(root, close);
function languageChanged(event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  const language = languages.find(item => item.code === value);
  if (language) emit('locale', language.code);
}
</script>
<template>
  <details ref="root" class="precision-settings" @keydown.esc.stop.prevent="close(true)">
    <summary ref="trigger" :aria-label="t('settings')">
      <svg class="settings-icon" aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M9.5 3h5l.6 2.4 1.6.9 2.4-.7 2.5 4.3-1.8 1.7v1.8l1.8 1.7-2.5 4.3-2.4-.7-1.6.9-.6 2.4h-5l-.6-2.4-1.6-.9-2.4.7-2.5-4.3 1.8-1.7v-1.8L2.4 9.9l2.5-4.3 2.4.7 1.6-.9Z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
      {{ t('settings') }}
    </summary>
    <section class="settings-panel" :aria-label="t('settings')">
      <header><strong>{{ t('settings') }}</strong><button type="button" :aria-label="t('settingsClose')" @click="close(true)">×</button></header>
      <label for="settings-language">{{ t('language') }}</label>
      <select id="settings-language" :value="locale" @change="languageChanged"><option v-for="language in languages" :key="language.code" :value="language.code" :lang="language.code">{{ language.name }}</option></select>
      <label for="settings-theme">{{ t('settingsAppearance') }}</label>
      <select id="settings-theme" :value="theme" @change="emit('theme', resolveTheme(($event.target as HTMLSelectElement).value))">
        <option value="system">{{ t('settingsSystem') }}</option><option value="light">{{ t('settingsLight') }}</option><option value="dark">{{ t('settingsDark') }}</option>
      </select>
      <label for="settings-order">{{ t('messageOrder') }}</label>
      <select id="settings-order" :value="order" @change="emit('order', resolveMessageOrder(($event.target as HTMLSelectElement).value))"><option value="top">{{ t('newestFirst') }}</option><option value="bottom">{{ t('oldestFirst') }}</option></select>
      <label for="settings-buffer">{{ t('bufferCapacity') }}</label>
      <select id="settings-buffer" :value="bufferSize" @change="emit('bufferSize', resolveBufferSize(($event.target as HTMLSelectElement).value))"><option v-for="size in bufferSizes" :key="size" :value="size">{{ translate(locale, 'messageCount', { count: size }) }}</option></select>
      <label class="settings-toggle" for="settings-connection-guides"><input id="settings-connection-guides" type="checkbox" :checked="showConnectionGuides" @change="emit('connectionGuides', ($event.target as HTMLInputElement).checked)" />{{ t('settingsShowConnectionGuides') }}</label>
      <label v-if="developmentBuild" class="settings-performance-toggle settings-toggle" for="settings-performance"><input id="settings-performance" type="checkbox" :checked="performance" @change="emit('performance', ($event.target as HTMLInputElement).checked)" />{{ t('performanceToggle') }}</label>
      <p>{{ t('settingsStorage') }}</p>
      <footer class="settings-version"><span>{{ t('settingsVersion') }}</span><span>{{ appVersion }}</span></footer>
    </section>
  </details>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useDisclosureDismissal } from '../composables/useDisclosureDismissal';
import { languages, translate, type Locale } from '../i18n';
import { bufferSizes, resolveBufferSize, resolveMessageOrder, resolveTheme, type Theme, type MessageOrder } from '../preferences';
const props = defineProps<{ locale: Locale; theme: Theme; order: MessageOrder; bufferSize: number }>();
const emit = defineEmits<{ order: [value: MessageOrder]; locale: [value: Locale]; theme: [value: Theme]; bufferSize: [value: number] }>();
const root = ref<HTMLDetailsElement>();
const trigger = ref<HTMLElement>();
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
    <summary ref="trigger" :aria-label="t('settings')"><span aria-hidden="true">⚙</span> {{ t('settings') }}</summary>
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
      <p>{{ t('settingsStorage') }}</p>
    </section>
  </details>
</template>

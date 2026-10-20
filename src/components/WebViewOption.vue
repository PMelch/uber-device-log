<script setup lang="ts">
import { computed } from 'vue';
import type { WebView } from '../../shared/types';
import { useI18n } from '../i18n';
import { webViewLabel } from '../webview-label';
import OverlayPanel from './OverlayPanel.vue';
const props = defineProps<{ view: WebView; siblings: WebView[]; device: string; selected: boolean; disabled: boolean }>();
defineEmits<{ select: [] }>();
const { t } = useI18n();
const label = computed(() => webViewLabel(props.view, props.siblings));
const name = computed(() => label.value.name || t('webviewConsole'));
</script>
<template>
  <div class="webview-option" :class="{ 'is-included': selected }">
    <button type="button" class="webview-select" :disabled="disabled" :aria-pressed="selected" :aria-label="t('webviewSelect', { title: [name, label.subtitle].filter(Boolean).join(' · '), device })" @click="$emit('select')">
      <span class="precision-platform precision-web" aria-hidden="true"></span>
      <span class="webview-label"><strong>{{ name }}</strong><span class="precision-sub">{{ label.subtitle || '—' }}</span></span>
      <span class="webview-check" aria-hidden="true">✓</span>
    </button>
    <div class="webview-info" @click.stop @keydown.stop>
      <OverlayPanel :label="t('webviewDetails', { title: name })" :width="360" panel-class="webview-details">
        <template #trigger><span aria-hidden="true">ⓘ</span></template>
        <template #default="{ close }">
          <div class="webview-details-heading"><strong>{{ name }}</strong><button type="button" :aria-label="t('close')" @click="close(true)">×</button></div>
          <label class="webview-url"><span>{{ t('webviewUrl') }}</span><input readonly :value="view.url" @focus="($event.target as HTMLInputElement).select()" /></label>
          <dl><dt>{{ t('webviewIdentifier') }}</dt><dd>{{ view.id }}</dd></dl>
        </template>
      </OverlayPanel>
    </div>
  </div>
</template>

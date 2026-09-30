import { onUnmounted, ref, watch } from 'vue';
import { preferenceKeys, readPreference, resolveBufferSize, resolveMessageOrder, resolveTheme, savePreference } from '../preferences';

export function usePreferences() {
  const newestPosition = ref(resolveMessageOrder(readPreference(preferenceKeys.order)));
  watch(newestPosition, value => savePreference(preferenceKeys.order, value), { flush: 'sync' });
  const bufferSize = ref(resolveBufferSize(readPreference(preferenceKeys.bufferSize)));
  const theme = ref(resolveTheme(readPreference(preferenceKeys.theme)));
  const system = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-color-scheme: dark)') : undefined;
  function applyTheme() {
    if (typeof document === 'undefined') return;
    const effective = theme.value === 'system' ? (system?.matches ? 'dark' : 'light') : theme.value;
    document.documentElement.dataset.theme = effective;
    document.documentElement.style.colorScheme = effective;
  }
  watch(theme, value => { savePreference(preferenceKeys.theme, value); applyTheme(); }, { flush: 'sync' });
  watch(bufferSize, value => savePreference(preferenceKeys.bufferSize, String(value)), { flush: 'sync' });
  applyTheme();
  system?.addEventListener('change', applyTheme);
  onUnmounted(() => system?.removeEventListener('change', applyTheme));
  return { bufferSize, theme, newestPosition };
}

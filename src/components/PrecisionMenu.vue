<script setup lang="ts">
import { ref } from 'vue';
import { useDisclosureDismissal } from '../composables/useDisclosureDismissal';
defineProps<{ label: string; disabled?: boolean }>();
const root = ref<HTMLDetailsElement>();
function close(focus = false) {
  if (!root.value) return;
  root.value.open = false;
  if (focus) root.value.querySelector('summary')?.focus();
}
useDisclosureDismissal(root, close);
function keys(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); close(true); }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  if (!root.value) return;
  root.value.open = true;
  const buttons = Array.from(root.value.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : event.key === 'ArrowDown' ? (index + 1) % buttons.length : (index <= 0 ? buttons.length : index) - 1;
  buttons[next]?.focus();
}
</script>
<template>
  <button v-if="disabled" type="button" class="precision-menu-trigger" disabled :aria-label="label"><slot name="selected" /><span class="menu-chevron" aria-hidden="true">⌄</span></button>
  <details v-else ref="root" @keydown="keys">
    <summary :aria-label="label"><slot name="selected" /><span class="menu-chevron" aria-hidden="true">⌄</span></summary>
    <div class="precision-menu" @click="event => { if ((event.target as HTMLElement).closest('button:not(:disabled)')) close(true); }"><slot /></div>
  </details>
</template>

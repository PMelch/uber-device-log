<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, useId } from 'vue';
const props = withDefaults(defineProps<{ label: string; width?: number; panelClass?: string }>(), { width: 420 });
const id = useId();
const trigger = ref<HTMLButtonElement>();
const panel = ref<HTMLElement>();
const open = ref(false);
function position() {
  if (!panel.value || !trigger.value || !open.value) return;
  const anchor = trigger.value.getBoundingClientRect();
  const bounds = panel.value.getBoundingClientRect();
  const mobile = window.innerWidth <= 700;
  const left = mobile ? 12 : Math.max(12, Math.min(anchor.right - bounds.width, window.innerWidth - bounds.width - 12));
  const top = mobile ? window.innerHeight - bounds.height - 12
    : Math.max(12, Math.min(anchor.bottom + 8, window.innerHeight - bounds.height - 12));
  panel.value.style.left = `${left}px`;
  panel.value.style.top = `${top}px`;
}
function close(focus = false) {
  panel.value?.hidePopover();
  open.value = false;
  if (focus) trigger.value?.focus({ preventScroll: true });
}
async function toggle() {
  if (open.value) { close(true); return; }
  open.value = true;
  panel.value?.showPopover();
  await nextTick();
  position();
}
function toggled(event: Event) {
  open.value = (event as ToggleEvent).newState === 'open';
  if (open.value) position();
}
function escape(event: KeyboardEvent) {
  if (event.defaultPrevented) return;
  event.preventDefault();
  event.stopPropagation();
  close(true);
}
let observer: ResizeObserver | undefined;
onMounted(() => {
  window.addEventListener('resize', position);
  window.addEventListener('scroll', position, true);
  observer = new ResizeObserver(position);
  if (panel.value) observer.observe(panel.value);
});
onUnmounted(() => {
  window.removeEventListener('resize', position);
  window.removeEventListener('scroll', position, true);
  observer?.disconnect();
});
defineExpose({ close });
</script>
<template>
  <button ref="trigger" type="button" class="overlay-trigger" :aria-label="label" :aria-expanded="open" :aria-controls="id" @click="toggle"><slot name="trigger" /></button>
  <section :id="id" ref="panel" popover="auto" class="precision-overlay" :class="panelClass" :style="{ width: `${props.width}px` }" :aria-label="label" @toggle="toggled" @keydown.esc="escape">
    <slot :close="close" />
  </section>
</template>

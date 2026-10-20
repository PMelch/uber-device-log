<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, useId } from 'vue';
import { featureStatusCopy, type FeatureStatus } from '../feature-status';
import type { MessageKey } from '../i18n/en';
const props = defineProps<{ status?: FeatureStatus; t: (key: MessageKey) => string; passive?: boolean; descriptionId?: string }>();
const fallbackId = useId();
const anchor = ref<HTMLElement>(), tooltip = ref<HTMLElement>();
let active = false;
async function show() {
  if (!props.status || !tooltip.value) return;
  active = true;
  tooltip.value.showPopover();
  await nextTick();
  if (!active || !anchor.value || !tooltip.value) return;
  const box = anchor.value.getBoundingClientRect(), hint = tooltip.value.getBoundingClientRect();
  tooltip.value.style.left = `${Math.max(8, Math.min(box.left, innerWidth - hint.width - 8))}px`;
  tooltip.value.style.top = `${Math.max(8, box.top > hint.height + 16 ? box.top - hint.height - 8 : Math.min(box.bottom + 8, innerHeight - hint.height - 8))}px`;
}
function hide() { active = false; tooltip.value?.hidePopover(); }
onMounted(() => { window.addEventListener('resize', hide); window.addEventListener('scroll', hide, true); });
onUnmounted(() => { hide(); window.removeEventListener('resize', hide); window.removeEventListener('scroll', hide, true); });
defineExpose({ show, hide });
</script>
<template>
  <span v-if="status" ref="anchor" class="feature-status-badge" :data-status="status" :tabindex="passive ? undefined : 0" :aria-describedby="descriptionId ?? fallbackId" @pointerenter="show" @pointerleave="hide" @focus="show" @blur="hide" @keydown.esc.stop.prevent="hide">
    {{ t(featureStatusCopy[status].label) }}
    <span :id="descriptionId ?? fallbackId" ref="tooltip" popover="manual" role="tooltip" class="feature-status-tooltip">{{ t(featureStatusCopy[status].description) }}</span>
  </span>
</template>
<style scoped>
.feature-status-badge { display: inline-flex; align-items: center; flex: 0 0 auto; padding: 2px 6px; border: 1px solid #e4c785; border-radius: 5px; background: #fff6df; color: #795400; font: 600 10px/1.4 system-ui,sans-serif; letter-spacing: .02em; white-space: nowrap; vertical-align: middle; cursor: help; }
.feature-status-badge[data-status=beta],.feature-status-badge[data-status=preview] { color: #245ba6; background: #edf4ff; border-color: #bcd1f0; }
.feature-status-badge:focus-visible { outline: 2px solid var(--pl-accent,#2565cb); outline-offset: 3px; }
.feature-status-tooltip { position: fixed; inset: auto; margin: 0; padding: 9px 12px; width: max-content; max-width: min(290px,calc(100vw - 16px)); border: 1px solid #d8dce4; border-radius: 8px; background: #fff; color: #343945; box-shadow: 0 5px 20px #0002; font: 12px/1.5 system-ui,sans-serif; letter-spacing: normal; white-space: normal; text-align: start; pointer-events: none; }
:global(:root[data-theme=dark] .feature-status-badge) { color: #f3d48f; background: #3b301d; border-color: #766137; }
:global(:root[data-theme=dark] .feature-status-badge[data-status=beta]),:global(:root[data-theme=dark] .feature-status-badge[data-status=preview]) { color: #adceff; background: #24344c; border-color: #4a6487; }
:global(:root[data-theme=dark] .feature-status-tooltip) { background: #252830; color: #eceef3; border-color: #454b58; }
</style>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { DetailRecord } from '../composables/useLogDetails';
import { interpretLog, logDetailsJson, type Interpretation } from '../../shared/log-details';
import { formatLogMessages } from '../../shared/log-view';
import { translate, type Locale } from '../i18n';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../../shared/notifications';

const props = defineProps<{ record: DetailRecord; pinned: boolean; position: { left: string; top: string; maxHeight?: string }; locale: Locale }>();
const emit = defineEmits<{ close: []; pin: []; enter: []; leave: [] }>();
const panel = ref<HTMLElement>();
const closeButton = ref<HTMLButtonElement>();
const view = ref<'fields' | 'raw' | 'json'>('fields');
const t = (key: MessageKey, params?: MessageParams) => translate(props.locale, key, params);
const parsed = computed(() => interpretLog(props.record.entry, props.record.device.platform));
const original = computed(() => formatLogMessages([props.record.entry]));
const json = computed(() => logDetailsJson(props.record.entry, props.record.device.platform, parsed.value));
const interpretations: Record<Interpretation, MessageKey> = {
  fileRead: 'detailFileRead', generic: 'detailGeneric', audio: 'detailAudio', brightness: 'detailBrightness', lux: 'detailLux',
  dns: 'detailDns', power: 'detailPower', invalidType: 'detailInvalidType', stack: 'detailStack',
};
const fields = computed(() => {
  const p = parsed.value;
  const ios = props.record.device.platform === 'ios';
  const rows: [MessageKey, string | undefined][] = [
    [ios ? 'detailReceived' : 'detailTimestamp', props.record.entry.timestamp],
    ['detailDevice', props.record.device.name],
  ];
  if (ios) rows.push(['detailDeviceTime', p.deviceTimestamp], ['detailHost', p.host], ['detailProcess', p.process], ['detailComponent', p.component]);
  else rows.push(['detailTag', p.tag]);
  rows.push(['detailPid', p.pid], ['detailLevel', p.level]);
  if (p.sourceLocation) rows.push(['detailSource', p.sourceLocation]);
  if (p.fileFailure) rows.push(
    ['detailOperation', p.fileFailure.operation], ['detailPath', p.fileFailure.path],
    ['detailException', p.fileFailure.exception], ['detailErrorCode', p.fileFailure.errorCode],
    ['detailReason', p.fileFailure.reason],
  );
  return rows;
});
watch(() => props.record.entry.key, () => { view.value = 'fields'; });
watch(() => [props.pinned, props.record.entry.key] as const, async ([pinned]) => {
  if (pinned) {
    await nextTick();
    if (!panel.value?.contains(document.activeElement)) closeButton.value?.focus({ preventScroll: true });
  }
}, { immediate: true });
function blur(event: FocusEvent) {
  if (!(event.relatedTarget instanceof Node) || !panel.value?.contains(event.relatedTarget)) emit('leave');
}
</script>

<template>
  <aside id="log-message-details" ref="panel" class="precision-log-detail" role="dialog" aria-modal="false" aria-labelledby="log-detail-title" :style="position" @pointerenter="emit('enter')" @pointerleave="emit('leave')" @focusin="emit('enter')" @focusout="blur" @pointerdown.stop>
    <header class="log-detail-header">
      <div><h2 id="log-detail-title">{{ t('detailTitle', { count: record.entry.key + 1 }) }}</h2><span class="log-detail-state">{{ t(pinned ? 'detailPinned' : 'detailPreview') }}</span></div>
      <div class="log-detail-actions"><button v-if="!pinned" type="button" class="precision-action" @click="emit('pin')">{{ t('detailPin') }}</button><button ref="closeButton" type="button" class="log-detail-close" :aria-label="t('detailClose')" @click="emit('close')">×</button></div>
    </header>
    <div class="log-detail-tabs">
      <button v-for="option in (['fields', 'raw', 'json'] as const)" :key="option" type="button" :aria-pressed="view === option" @click="view = option; emit('pin')">{{ t(option === 'fields' ? 'detailTabFields' : option === 'raw' ? 'detailTabRaw' : 'detailTabJson') }}</button>
    </div>
    <div v-if="view === 'fields'" class="log-detail-content">
      <dl><template v-for="[label, value] in fields" :key="label"><dt>{{ t(label) }}</dt><dd>{{ value ?? t('detailUnavailable') }}</dd></template></dl>
      <p v-if="parsed.format === 'unrecognized'" class="log-detail-notice">{{ t('detailNoHeader') }}</p>
      <p v-if="parsed.deviceTimestamp" class="log-detail-notice">{{ t('detailTimeNote') }}</p>
      <section class="log-detail-explanation"><h3>{{ t('detailInterpretation') }}</h3><p>{{ t(interpretations[parsed.interpretation]) }}</p></section>
      <p v-if="parsed.hasPrivateData" class="log-detail-notice">{{ t('detailPrivate') }}</p>
    </div>
    <pre v-else class="log-detail-raw">{{ view === 'raw' ? original : json }}</pre>
    <footer>{{ t('detailSnapshot') }}</footer>
  </aside>
</template>

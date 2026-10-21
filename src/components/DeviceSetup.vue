<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { DeviceSetup } from '../../shared/types';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../../shared/notifications';
import { setupSteps, setupTitles } from '../device-setup';
import SetupCommand from './SetupCommand.vue';
const props = defineProps<{ setup?: DeviceSetup; loading: boolean; connected: boolean; t: (key: MessageKey, params?: MessageParams) => string }>();
const emit = defineEmits<{ retry: []; resolved: [] }>();
const root = ref<HTMLElement>();
const trigger = ref<HTMLElement>();
const distribution = ref('debian');
const hostName = computed(() => props.setup?.host === 'windows' ? 'Windows' : props.setup?.host === 'macos' ? 'macOS' : props.setup?.host === 'linux' ? 'Linux' : props.t('setupOtherHost'));
const install = computed(() => distribution.value === 'fedora' ? 'sudo dnf install usbmuxd libimobiledevice-utils' : 'sudo apt-get install usbmuxd libimobiledevice-utils');
// When polling removes the focused issue, move focus to a surviving control.
watch(() => props.setup?.issues, async () => {
  if (typeof document === 'undefined') return;
  const active = document.activeElement;
  const inside = !!active && !!root.value?.contains(active);
  await nextTick();
  if (inside && !active?.isConnected) {
    if (trigger.value) trigger.value.focus(); else emit('resolved');
  }
});
</script>
<template>
  <section v-if="setup?.issues.length" ref="root" class="device-setup" :aria-label="t('setupTitle')">
    <details class="setup-overview" :open="!connected">
      <summary ref="trigger"><span>{{ t('setupTitle') }}</span><span aria-hidden="true">⌄</span></summary>
      <div class="setup-content">
        <header><div><p>{{ t('setupHost', {host:hostName}) }}</p><p>{{ t('setupIntro') }}</p></div><button type="button" class="setup-retry" :aria-disabled="loading" :aria-busy="loading" @click="!loading && emit('retry')"><span aria-hidden="true">↻</span>{{ t('setupRetry') }}</button></header>
        <details v-for="issue in setup.issues" :key="issue.reason" class="setup-guide" :data-issue="issue.reason" open>
          <summary><span>{{ t(setupTitles[issue.reason]) }}</span><span aria-hidden="true">⌄</span></summary>
          <div class="setup-guide-body">
            <ol><li v-for="step in setupSteps(setup.host, issue)" :key="step.message">
              <p>{{ t(step.message, step.params) }}</p>
              <a v-if="step.link" :href="step.link.url" target="_blank" rel="noopener noreferrer">{{ t(step.link.label) }} <span aria-hidden="true">↗</span></a>
              <template v-if="step.distribution"><label class="setup-distro">{{ t('setupDistro') }}<select v-model="distribution"><option value="debian">Ubuntu / Debian</option><option value="fedora">Fedora</option></select></label><SetupCommand :command="install" :t="t" /><p class="setup-package-note">{{ t('setupLinuxPackages') }}</p></template>
              <SetupCommand v-for="command in step.commands" :key="command" :command="command" :t="t" />
            </li></ol>
            <details class="setup-technical"><summary><span>{{ t('setupDetails') }}</span><span aria-hidden="true">⌄</span></summary><SetupCommand :command="issue.detail" :t="t" /></details>
          </div>
        </details>
        <footer><p>{{ t('setupCommandsHint') }}</p><p v-if="setup.host === 'windows' || setup.host === 'linux'">{{ t('setupHardwareNote') }}</p></footer>
      </div>
    </details>
  </section>
</template>
<style scoped>
.device-setup { min-width:0; flex:none; }
#precision-design .setup-overview { border:1px solid var(--pl-line); border-radius:10px; background:var(--pl-panel); }
#precision-design .device-setup summary { white-space:normal; overflow-wrap:anywhere; min-width:0; justify-content:space-between; gap:12px; border:0; border-radius:6px; padding:12px 14px; font-size:13px; font-weight:500; }
#precision-design .setup-overview > summary { color:var(--pl-warn); }
#precision-design .device-setup summary > span:last-child { flex:none; }
#precision-design .device-setup details[open] > summary > span:last-child { transform:rotate(180deg); }
.setup-content { padding:0 16px 16px; }
.setup-content header { display:flex; align-items:start; justify-content:space-between; gap:16px; margin:4px 0 16px; }
#precision-design .setup-content p { margin:6px 0; }
#precision-design .setup-retry { display:inline-flex; align-items:center; gap:8px; flex:none; border:1px solid var(--pl-line); border-radius:6px; background:var(--pl-panel); min-height:38px; padding:7px 11px; font-size:13px; white-space:normal; }
.setup-retry[aria-disabled=true] { opacity:.6; cursor:wait; }
#precision-design .setup-guide { border:1px solid var(--pl-line); border-radius:7px; margin-top:12px; }
.setup-guide-body { padding:0 16px 12px; }
ol { margin:0; padding-left:22px; } li { padding:4px 0 5px 4px; }
.device-setup a { display:inline-block; margin:4px 0; color:var(--pl-accent); font-size:13px; text-underline-offset:3px; }
.device-setup a:focus-visible,.device-setup select:focus-visible { outline:2px solid var(--pl-accent); outline-offset:3px; }
.setup-distro { display:flex; align-items:center; flex-wrap:wrap; gap:10px; margin-top:10px; font-size:13px; }
.setup-distro select { max-width:100%; min-width:0; background:var(--pl-panel); color:var(--pl-text); font:inherit; border:1px solid var(--pl-line); border-radius:5px; padding:6px; }
#precision-design .device-setup .setup-technical > summary { padding:8px 0; font-size:12px; color:var(--pl-soft); margin-top:8px; }
#precision-design .setup-content footer p,#precision-design .setup-package-note { font-size:12px; }
.setup-content footer { margin-top:14px; }
@media(max-width:700px) { .setup-content { padding:0 12px 12px; }.setup-content header { flex-wrap:wrap; gap:10px; }.setup-guide-body { padding:0 10px 10px; } }
@media(pointer:coarse) { #precision-design .device-setup summary,#precision-design .setup-retry { min-height:44px; }.setup-distro select { font-size:16px; } }
</style>

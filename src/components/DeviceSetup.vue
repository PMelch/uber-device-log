<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { DeviceSetup } from '../../shared/types';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../../shared/notifications';
import { setupGuide, setupTitles, setupDescriptions, setupStepTitles } from '../device-setup';
import SetupCommand from './SetupCommand.vue';
const props = defineProps<{ setup?: DeviceSetup; loading: boolean; connected: boolean; t: (key: MessageKey, params?: MessageParams) => string }>();
const emit = defineEmits<{ retry: []; resolved: []; hide: [] }>();
const root = ref<HTMLElement>();
const trigger = ref<HTMLElement>();
const distribution = ref('debian');
const selectedPlatform = ref('android');
const platforms = computed(() => [...new Set(props.setup?.issues.map(issue => issue.platform) ?? [])]);
const activePlatform = computed(() => platforms.value.find(platform => platform === selectedPlatform.value) ?? platforms.value[0]);
const activeIssues = computed(() => props.setup?.issues.filter(issue => issue.platform === activePlatform.value) ?? []);
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
        <header><p class="setup-host">{{ t('setupHost', {host:hostName}) }}</p><p>{{ t('setupIntro') }}</p></header>
        <div v-if="platforms.length > 1" class="setup-platforms">
          <button v-for="platform in platforms" :key="platform" type="button" :aria-pressed="activePlatform === platform" @click="selectedPlatform = platform">{{ platform === 'android' ? 'Android' : 'iOS' }}<span class="setup-status-dot" aria-hidden="true" /></button>
        </div>
        <section v-for="issue in activeIssues" :key="issue.reason" class="setup-guide" :data-issue="issue.reason" :aria-label="t(setupTitles[issue.reason])">
          <div class="setup-reason"><p class="setup-reason-label">{{ t('setupReasonLabel') }}</p><h3>{{ t(setupTitles[issue.reason]) }}</h3><p>{{ t(setupDescriptions[issue.reason]) }}</p></div>
          <div class="setup-guide-body">
            <details v-for="(step, index) in setupGuide(setup.host, issue).steps" :key="step.message" class="setup-step" :open="index === 0">
              <summary><span class="setup-number" aria-hidden="true">{{ index + 1 }}</span><span>{{ t(setupStepTitles[step.message] ?? step.message) }}</span><span class="setup-chevron" aria-hidden="true">⌄</span></summary>
              <div class="setup-step-body">
              <p>{{ t(step.message, step.params) }}</p>
              <a v-if="step.link" :href="step.link.url" target="_blank" rel="noopener noreferrer">{{ t(step.link.label) }} <span aria-hidden="true">↗</span></a>
              <template v-if="step.distribution"><label class="setup-distro">{{ t('setupDistro') }}<select v-model="distribution"><option value="debian">Ubuntu / Debian</option><option value="fedora">Fedora</option></select></label><SetupCommand :command="install" :t="t" /><p class="setup-package-note">{{ t('setupLinuxPackages') }}</p></template>
              <SetupCommand v-for="command in step.commands" :key="command" :command="command" :t="t" />
              </div>
            </details>
            <details v-if="setupGuide(setup.host, issue).troubleshooting.length" class="setup-troubleshooting">
              <summary><span>{{ t('setupTroubleshooting') }}</span><span class="setup-chevron" aria-hidden="true">⌄</span></summary>
              <div v-for="step in setupGuide(setup.host, issue).troubleshooting" :key="step.message" class="setup-step-body">
                <h4>{{ t(setupStepTitles[step.message] ?? step.message) }}</h4><p>{{ t(step.message, step.params) }}</p>
                <a v-if="step.link" :href="step.link.url" target="_blank" rel="noopener noreferrer">{{ t(step.link.label) }} <span aria-hidden="true">↗</span></a>
                <SetupCommand v-for="command in step.commands" :key="command" :command="command" :t="t" />
              </div>
            </details>
          </div>
        </section>
        <footer><p>{{ t('setupCommandsHint') }}</p><div class="setup-footer-actions"><button type="button" class="setup-hide" @click="emit('hide')">{{ t('setupHideGuides') }}</button><button type="button" class="setup-retry" :aria-disabled="loading" :aria-busy="loading" @click="!loading && emit('retry')"><span aria-hidden="true">↻</span>{{ t('setupRetry') }}</button></div></footer>
      </div>
    </details>
  </section>
</template>
<style scoped>
.device-setup { min-width:0; flex:none; }
#precision-design .setup-overview { border:1px solid var(--pl-line); border-radius:10px; background:var(--pl-panel); }
#precision-design .device-setup summary { white-space:normal; overflow-wrap:anywhere; min-width:0; justify-content:space-between; gap:12px; border:0; border-radius:6px; padding:12px 14px; font-size:13px; font-weight:500; }
#precision-design .setup-overview > summary { color:var(--pl-text); font-size:16px; padding:18px 20px; }
#precision-design .device-setup summary > span:last-child { flex:none; }
#precision-design .device-setup details[open] > summary > span:last-child { transform:rotate(180deg); }
.setup-content { padding:0 20px; }
.setup-content header { margin:0 0 16px; }
#precision-design .setup-host { font-size:12px; }
#precision-design .setup-content p { margin:6px 0; }
#precision-design .setup-retry { display:inline-flex; align-items:center; justify-content:center; gap:8px; flex:none; border:1px solid var(--pl-text); color:var(--pl-panel); border-radius:6px; background:var(--pl-text); min-height:38px; padding:8px 12px; font-size:13px; white-space:normal; }
.setup-retry[aria-disabled=true] { opacity:.6; cursor:wait; }
.setup-footer-actions { display:flex; flex-wrap:wrap; align-items:center; gap:10px; }
#precision-design .setup-hide { padding:8px 10px; min-height:38px; border-radius:6px; font-size:13px; }
#precision-design .setup-hide:hover { background:var(--pl-line); }
#precision-design .setup-guide { margin-top:20px; }
.setup-guide-body { padding:0; }
.setup-platforms { display:flex; gap:20px; border-bottom:1px solid var(--pl-line); flex-wrap:wrap; }
#precision-design .setup-platforms button { display:inline-flex; align-items:center; gap:8px; padding:10px 0; border-bottom:2px solid transparent; }
#precision-design .setup-platforms button[aria-pressed=true] { color:var(--pl-accent); border-bottom-color:var(--pl-accent); }
.setup-status-dot { width:6px; height:6px; border-radius:50%; background:var(--pl-warn); }
.setup-reason { margin-bottom:20px; }
#precision-design .setup-reason-label { font-size:12px; margin-bottom:6px; }
.setup-reason h3 { font-size:14px; font-weight:500; margin:0; }
.setup-step,.setup-troubleshooting { border-top:1px solid var(--pl-line); }
#precision-design .setup-step > summary { padding:14px 0; justify-content:flex-start; }
#precision-design .setup-step .setup-number { display:grid; place-items:center; width:25px; height:25px; flex:none; border:1px solid var(--pl-line); border-radius:50%; font-size:12px; color:var(--pl-soft); }
#precision-design .setup-step > summary > span:nth-child(2) { flex:1; min-width:0; }
#precision-design .setup-chevron { margin-left:auto; }
.setup-step-body { padding:0 0 14px 37px; min-width:0; }
.setup-step-body h4 { font-size:13px; font-weight:500; margin:10px 0 6px; }
#precision-design .setup-troubleshooting > summary { padding:14px 0; }
.device-setup a { display:inline-block; margin:4px 0; color:var(--pl-accent); font-size:13px; text-underline-offset:3px; }
.device-setup a:focus-visible,.device-setup select:focus-visible { outline:2px solid var(--pl-accent); outline-offset:3px; }
.setup-distro { display:flex; align-items:center; flex-wrap:wrap; gap:10px; margin-top:10px; font-size:13px; }
.setup-distro select { max-width:100%; min-width:0; background:var(--pl-panel); color:var(--pl-text); font:inherit; border:1px solid var(--pl-line); border-radius:5px; padding:6px; }
#precision-design .setup-content footer p,#precision-design .setup-package-note { font-size:12px; }
.setup-content footer { margin:12px -20px 0; padding:16px 20px; display:flex; align-items:center; justify-content:space-between; gap:16px; border-top:1px solid var(--pl-line); border-radius:0 0 10px 10px; background:var(--pl-wash); }
@media(max-width:700px) { .setup-content { padding:0 14px; }.setup-step-body { padding-left:0; }.setup-content footer { margin-inline:-14px; padding:14px; flex-wrap:wrap; }.setup-content footer p { flex-basis:100%; } }
@media(pointer:coarse) { #precision-design .device-setup summary,#precision-design .setup-retry,#precision-design .setup-hide { min-height:44px; }.setup-distro select { font-size:16px; } }
</style>

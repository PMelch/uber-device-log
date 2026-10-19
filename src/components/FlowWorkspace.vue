<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { FlowBlueprint, FlowDiagnostic, FlowInstance, FlowObservation, FlowOutcome, FlowSnapshot, FlowStep } from '../../shared/flow-types';
import { translate, translateMessage, type Locale } from '../i18n';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../../shared/notifications';
import './flow-workspace.css';

const props = defineProps<{ snapshot: FlowSnapshot | null; instances: FlowInstance[]; loading: boolean; gapCount: number; activeSources: number; locale: Locale }>();
const emit = defineEmits<{ clear: []; reload: [] }>();
function diagnosticLocation(value: FlowDiagnostic) { return [value.file && [value.file, value.line, value.column].filter(part => part !== undefined).join(':'), value.path].filter(Boolean).join(' · '); }
const t = (key: MessageKey, params?: MessageParams) => translate(props.locale, key, params);
const view = ref<'list' | 'timeline' | 'info' | 'editor'>('list');
const query = ref('');
const selectedId = ref('');
const selectedBlueprintId = ref('');
const selectedStep = ref('');
const inspector = ref<'payload' | 'match' | 'raw'>('payload');
const reveal = ref(false);
const title = ref<HTMLElement>();
const clock = ref(0);
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => { clock.value = performance.timeOrigin + performance.now(); timer = setInterval(() => { clock.value = performance.timeOrigin + performance.now(); }, 1000); });
onBeforeUnmount(() => clearInterval(timer));
const selected = computed(() => props.instances.find(value => value.id === selectedId.value));
const blueprint = computed(() => selected.value?.blueprint ?? props.snapshot?.blueprints.find(value => value.id === selectedBlueprintId.value));
const step = computed(() => blueprint.value?.steps.find(value => value.id === selectedStep.value));
const evidence = computed(() => selected.value?.observations.filter(value => value.stepId === selectedStep.value) ?? []);
const visible = computed(() => {
  const text = query.value.trim().toLocaleLowerCase(props.locale);
  return [...props.instances].reverse().filter(value => !text || [value.blueprint.name, value.id, value.deviceId, value.errorCode, value.errorDescription, ...Object.values(value.bindings ?? {})].join(' ').toLocaleLowerCase(props.locale).includes(text));
});
const outcomes: Record<FlowOutcome, MessageKey> = { running: 'flowsStatusRunning', completed: 'flowsStatusCompleted', failed: 'flowsStatusFailed', cancelled: 'flowsStatusCancelled', timed_out: 'flowsStatusTimedOut', interrupted: 'flowsStatusInterrupted' };
const completeness: Partial<Record<FlowInstance['completeness'], MessageKey>> = { missing_start: 'flowsCompletenessMissingStart', missing_steps: 'flowsCompletenessMissingSteps', capture_gap: 'flowsCompletenessCaptureGap', ambiguous: 'flowsCompletenessAmbiguous' };
function elapsed(value: FlowInstance) {
  return t('flowsDuration', { seconds: Math.round(Math.max(0, (value.endedAt ?? Math.max(value.updatedAt, clock.value)) - value.startedAt) / 100) / 10 });
}
function observed(value: FlowInstance, id: string) { return value.observations.some(observation => observation.stepId === id && observation.accepted !== false); }
function failedStep(value: FlowInstance, item: FlowStep) { return value.outcome === 'failed' && (item.outcome === 'failed' && observed(value, item.id) || value.observations.some(observation => observation.stepId === item.id && observation.errorCode)); }
function stepLabel(item: FlowStep, definition: FlowBlueprint) { return item.shortLabel ?? `S${definition.steps.findIndex(value => value.id === item.id) + 1}`; }
function path(value: FlowInstance): FlowStep[] {
  const degrees = new Map(value.blueprint.steps.map(item => [item.id, 0]));
  for (const item of value.blueprint.steps) for (const next of item.next ?? []) degrees.set(next, (degrees.get(next) ?? 0) + 1);
  const ready = value.blueprint.steps.filter(item => degrees.get(item.id) === 0), ordered: FlowStep[] = [];
  while (ready.length) { const item = ready.shift()!; ordered.push(item); for (const next of item.next ?? []) { degrees.set(next, degrees.get(next)! - 1); if (degrees.get(next) === 0) ready.push(value.blueprint.steps.find(step => step.id === next)!); } }
  if (value.outcome === 'failed' || value.outcome === 'cancelled') return ordered.filter(item => observed(value, item.id));
  return ordered.filter(item => stepState(value, item) !== 'flowsNotOnRoute' && (!item.optional || observed(value, item.id)));
}
function dependencies(observation: FlowObservation) {
  const values: string[] = [];
  for (const consumer of blueprint.value?.steps ?? []) {
    const visit = (matcher: FlowStep['match']) => {
      const ref = matcher.json?.equalsFrom;
      if (ref?.step === observation.stepId) values.push(`${ref.step}.${ref.field} → ${consumer.id}.${matcher.json!.path}`);
      matcher.all?.forEach(visit);
    };
    visit(consumer.match);
  }
  return values;
}
async function navigate(target: typeof view.value, instance?: FlowInstance) {
  if (instance) { selectedId.value = instance.id; selectedBlueprintId.value = instance.blueprint.id; selectedStep.value = instance.observations.at(-1)?.stepId ?? instance.blueprint.start; }
  reveal.value = false;
  view.value = target;
  await nextTick();
  title.value?.focus();
}
function inspect(id: string) { selectedStep.value = id; reveal.value = false; }
function stepState(instance: FlowInstance, item: FlowStep): MessageKey {
  if (observed(instance, item.id)) return 'flowsObserved';
  if (instance.expected.includes(item.id)) return 'flowsExpected';
  const witnessed = new Set(instance.observations.filter(value => value.accepted !== false).map(value => value.stepId));
  const reachable = (id: string, visited = new Set<string>()): Set<string> => {
    if (visited.has(id)) return visited;
    visited.add(id);
    for (const next of instance.blueprint.steps.find(value => value.id === id)?.next ?? []) reachable(next, visited);
    return visited;
  };
  for (const branch of instance.blueprint.steps.filter(value => (value.next?.length ?? 0) > 1)) {
    const routes = branch.next!.map(id => reachable(id));
    const unique = routes.map((route, index) => new Set([...route].filter(id => !routes.some((other, otherIndex) => index !== otherIndex && other.has(id)))));
    const taken = unique.findIndex(route => [...route].some(id => witnessed.has(id)));
    if (taken >= 0 && unique.some((route, index) => index !== taken && route.has(item.id))) return 'flowsNotOnRoute';
  }
  return item.optional ? 'flowsSkippedOptional' : 'flowsNotObserved';
}
function payload(observation: FlowObservation) {
  const definition = blueprint.value?.steps.find(item => item.id === observation.stepId)?.extract ?? blueprint.value?.errors?.find(item => item.id === observation.stepId)?.extract;
  return JSON.stringify(Object.fromEntries(Object.entries(observation.payload).map(([key, value]) => [key, !reveal.value && definition?.[key]?.sensitive ? t('flowsSensitive') : value])), null, 2);
}
function matching(observation: FlowObservation) {
  return JSON.stringify({ match: blueprint.value?.steps.find(item => item.id === observation.stepId)?.match ?? blueprint.value?.errors?.find(item => item.id === observation.stepId)?.match, matchedBy: reveal.value ? observation.matchedBy : undefined, source: observation.message.source, bindings: reveal.value ? selected.value?.bindings : t('flowsSensitive') }, null, 2);
}
function raw(observation: FlowObservation) {
  // Raw log evidence can contain receipts or tokens even if extracted fields are masked.
  return reveal.value ? JSON.stringify(observation.message, null, 2) : t('flowsSensitive');
}
watch(() => props.instances, () => { if (selectedId.value && !selected.value && view.value !== 'editor') void navigate('list'); });
const filename = ref('');
const source = ref('');
const revision = ref<string>();
const existing = ref(false);
const busy = ref(false);
const valid = ref(false);
const status = ref<MessageKey>();
const diagnostics = ref<FlowDiagnostic[]>([]);
const drafts = new Map<string, { source: string; revision?: string; existing: boolean }>();
function stash() { if (filename.value) drafts.set(filename.value, { source: source.value, revision: revision.value, existing: existing.value }); }
function loadFile(name: string, current = false) {
  stash();
  const file = props.snapshot?.files.find(item => item.filename === name);
  const draft = current ? undefined : drafts.get(name);
  filename.value = name;
  source.value = draft?.source ?? file?.source ?? '';
  revision.value = draft?.revision ?? file?.revision;
  existing.value = draft?.existing ?? !!file;
  valid.value = false; status.value = undefined; diagnostics.value = [];
}
async function openEditor() {
  if (!filename.value && props.snapshot?.files[0]) loadFile(props.snapshot.files[0].filename);
  await navigate('editor');
}
function newFile() { stash(); filename.value = ''; source.value = 'version: 1\nid: new-flow\nname: ' + JSON.stringify(t('flowsNewName')) + '\nstart: start\ntimeout: 90s\ncorrelation:\n  scope: device-session\n  primary: requestId\nsteps:\n  - id: start\n    name: ' + JSON.stringify(t('flowsNewStartName')) + '\n    match:\n      contains: flow.started\n    extract:\n      requestId: { json: requestId, required: true }\n    next: [done]\n  - id: done\n    name: ' + JSON.stringify(t('flowsNewDoneName')) + '\n    match:\n      all:\n        - contains: flow.completed\n        - json:\n            path: requestId\n            equalsFrom: { step: start, field: requestId }\n    outcome: completed\n'; revision.value = undefined; existing.value = false; changed(); }
function changed() { valid.value = false; status.value = 'flowsChanged'; diagnostics.value = []; }
async function request(action: 'validate' | 'save') {
  busy.value = true; diagnostics.value = []; status.value = undefined;
  try {
    const url = action === 'validate' ? '/api/flows/validate' : existing.value ? `/api/flows/blueprints/${encodeURIComponent(filename.value)}` : '/api/flows/blueprints';
    const response = await fetch(url, { method: action === 'save' && existing.value ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json', 'X-Flow-Token': props.snapshot?.token ?? '' }, body: JSON.stringify({ filename: filename.value, source: source.value, revision: revision.value }) });
    const result = await response.json();
    diagnostics.value = result.diagnostics ?? [];
    if (!response.ok) { status.value = response.status === 409 ? 'flowsConflict' : 'flowsNetworkError'; valid.value = false; return; }
    valid.value = !diagnostics.value.length;
    if (action === 'validate') status.value = valid.value ? 'flowsValid' : undefined;
    else { status.value = 'flowsSaved'; revision.value = result.files?.find((file: { filename: string; revision: string }) => file.filename === filename.value)?.revision ?? result.file?.revision ?? result.revision; existing.value = true; drafts.delete(filename.value); emit('reload'); valid.value = false; }
  } catch { status.value = 'flowsNetworkError'; valid.value = false; }
  finally { busy.value = false; }
}
</script>

<template>
  <section class="flow-workspace" :aria-label="t('flowsWorkspace')" @keydown.esc="view !== 'list' && navigate('list')">
    <div v-if="loading" role="status" class="flow-notice">{{ t('flowsLoading') }}</div>
    <div v-if="gapCount" role="status" class="flow-notice">{{ t('flowsGap', { count: gapCount }) }}</div>
    <div v-for="(diagnostic, index) in snapshot?.diagnostics" :key="index" class="flow-notice flow-warning"><code v-if="diagnosticLocation(diagnostic)">{{ diagnosticLocation(diagnostic) }}</code> {{ translateMessage(locale, diagnostic) }}</div>
    <div v-if="!loading && !snapshot?.enabled" class="flow-empty"><h2>{{ t('flowsTitle') }}</h2><p>{{ t('flowsNoProject') }}</p><code>npx uber-device-log --project=./test_flow_project</code><button type="button" @click="emit('reload')">{{ t('flowsReload') }}</button></div>
    <template v-else-if="snapshot?.enabled">
      <template v-if="view === 'list'">
        <div class="flow-toolbar"><input v-model="query" type="search" :placeholder="t('flowsSearch')" :aria-label="t('flowsSearch')"><button type="button" @click="openEditor">{{ t('flowsBlueprints') }} <span class="flow-count">{{ snapshot.files.length }}</span></button><button type="button" :disabled="!instances.length" @click="emit('clear')">{{ t('flowsClear') }}</button></div>
        <div v-if="!visible.length" class="flow-empty"><h2>{{ t(query ? 'flowsNoResults' : !snapshot.blueprints.length ? 'flowsNoBlueprints' : 'flowsEmpty') }}</h2><p>{{ t(!snapshot.blueprints.length ? 'flowsEditorHelp' : 'flowsEmptyHint') }}</p><button v-if="!snapshot.blueprints.length" type="button" @click="openEditor">{{ t('flowsNewBlueprint') }}</button></div>
        <article v-for="instance in visible" :key="instance.id" class="flow-card" :data-outcome="instance.outcome">
          <header><div class="flow-card-heading"><h2>{{ instance.blueprint.name }}</h2><span class="flow-id">#{{ instance.id }}</span><span class="flow-badge" :data-outcome="instance.outcome">{{ t(outcomes[instance.outcome]) }}</span></div><div class="flow-actions"><button type="button" @click="navigate('timeline', instance)">{{ t('flowsTimeline') }}</button><button type="button" @click="navigate('info', instance)">{{ t('flowsInfo') }}</button></div></header>
          <div class="flow-meta"><span>{{ instance.deviceId }}</span><span>{{ elapsed(instance) }}</span><span v-if="completeness[instance.completeness]" class="flow-warning">{{ t(completeness[instance.completeness]!) }}</span></div>
          <ol class="flow-path"><li v-for="item in path(instance)" :key="item.id" :class="{ 'is-observed': observed(instance, item.id), 'is-expected': instance.expected.includes(item.id), 'is-failed': failedStep(instance, item) }"><button type="button" @click="navigate('timeline', instance); inspect(item.id)"><span class="flow-node">{{ stepLabel(item, instance.blueprint) }}</span><span>{{ item.name }}<small>{{ t(stepState(instance, item)) }}</small></span></button></li><li v-if="instance.outcome === 'failed'" class="is-failed"><span class="flow-node" aria-hidden="true">!</span><span>{{ instance.errorCode ?? t('flowsStatusFailed') }}</span></li></ol>
          <p v-if="instance.errorCode || instance.errorDescription" class="flow-error-detail"><code>{{ instance.errorCode }}</code> {{ instance.errorDescription }}</p>
        </article>
      </template>
      <template v-else>
        <div class="flow-panelhead"><button type="button" @click="navigate('list')"><span aria-hidden="true">←</span> {{ t('flowsBack') }}</button><button v-if="view !== 'editor'" type="button" @click="openEditor">{{ t('flowsEditYaml') }}</button><button v-else type="button" :disabled="busy" @click="emit('reload')">{{ t('flowsReload') }}</button></div>
        <section v-if="view === 'timeline' && selected" class="flow-detail">
          <header class="flow-detail-heading"><h2 ref="title" tabindex="-1">{{ selected.blueprint.name }} <span class="flow-id">#{{ selected.id }}</span></h2><span class="flow-badge" :data-outcome="selected.outcome">{{ t(outcomes[selected.outcome]) }}</span><p>{{ elapsed(selected) }} · {{ t('flowsRevision', { revision: selected.revision }) }}</p><p v-if="selected.errorCode || selected.errorDescription"><code>{{ selected.errorCode }}</code> {{ selected.errorDescription }}</p></header>
          <div class="flow-detail-grid"><div class="flow-timeline"><button v-for="item in blueprint?.steps" :key="item.id" type="button" :aria-pressed="selectedStep === item.id" :class="{ 'is-observed': observed(selected, item.id), 'is-failed': failedStep(selected, item) }" @click="inspect(item.id)"><span class="flow-node">{{ stepLabel(item, selected.blueprint) }}</span><span><strong>{{ item.name }}</strong><small>{{ t(stepState(selected, item)) }}<template v-if="item.optional"> · {{ t('flowsOptional') }}</template></small></span></button><button v-for="item in selected.observations.filter(value => !blueprint?.steps.some(definition => definition.id === value.stepId))" :key="item.stepId" type="button" class="is-failed" :aria-pressed="selectedStep === item.stepId" @click="inspect(item.stepId)"><span class="flow-node">!</span>{{ item.stepId }}</button></div>
          <div class="flow-inspector"><h3>{{ step?.name ?? selectedStep }}</h3><div class="flow-subnav"><button v-for="option in (['payload', 'match', 'raw'] as const)" :key="option" type="button" :aria-pressed="inspector === option" @click="inspector = option; reveal = false">{{ t(option === 'payload' ? 'flowsPayload' : option === 'match' ? 'flowsMatch' : 'flowsRawLog') }}</button></div><button v-if="evidence.length" type="button" class="flow-reveal" :aria-pressed="reveal" @click="reveal = !reveal">{{ t(reveal ? 'flowsHide' : 'flowsReveal') }}</button><p v-if="!evidence.length">{{ t('flowsChooseStep') }}</p><div v-for="(observation, index) in evidence" :key="index" class="flow-evidence"><small>+{{ Math.round(observation.receivedAt - selected.startedAt) }} ms · {{ observation.message.timestamp }}</small><pre>{{ inspector === 'payload' ? payload(observation) : inspector === 'match' ? matching(observation) : raw(observation) }}</pre><div v-if="inspector === 'payload' && dependencies(observation).length" class="flow-provenance"><h3>{{ t('flowsMatch') }}</h3><code v-for="dependency in dependencies(observation)" :key="dependency">{{ dependency }}</code></div><p v-if="observation.errorCode || observation.errorDescription"><code>{{ observation.errorCode }}</code> {{ observation.errorDescription }}</p></div></div></div>
        </section>
        <section v-if="view === 'info' && blueprint" class="flow-detail"><header class="flow-detail-heading"><h2 ref="title" tabindex="-1">{{ blueprint.name }}</h2><p>{{ blueprint.description }}</p><p>{{ t('flowsTimeout', { timeout: blueprint.timeout }) }}</p></header><div class="flow-info-body"><div class="flow-graph"><article v-for="item in blueprint.steps" :key="item.id"><span class="flow-node">{{ stepLabel(item, blueprint) }}</span><div><h3>{{ item.name }} <small v-if="item.optional">{{ t('flowsOptional') }}</small></h3><code>{{ item.id }}</code><p v-if="item.next?.length">{{ t('flowsBranch') }}: <span v-for="next in item.next" :key="next" class="flow-route-target">{{ blueprint.steps.find(step => step.id === next)?.name ?? next }}</span></p><span v-if="item.outcome" class="flow-badge" :data-outcome="item.outcome">{{ t(outcomes[item.outcome]) }}</span><details><summary>{{ t('flowsMatch') }}</summary><pre>{{ JSON.stringify({ match: item.match, extract: item.extract }, null, 2) }}</pre></details></div></article></div><h3 v-if="blueprint.errors?.length">{{ t('flowsKnownErrors') }}</h3><dl class="flow-errors"><template v-for="error in blueprint.errors" :key="error.id"><template v-for="(definition, code) in error.codes" :key="code"><dt><code>{{ code }}</code></dt><dd>{{ definition.description }} <span class="flow-badge" :data-outcome="definition.outcome">{{ t(outcomes[definition.outcome]) }}</span></dd></template></template></dl></div></section>
        <section v-if="view === 'editor'" class="flow-detail"><header class="flow-detail-heading"><h2 ref="title" tabindex="-1">{{ t('flowsBlueprints') }}</h2><p>{{ snapshot.directory }}</p></header><div class="flow-editor-grid"><div class="flow-filelist"><button v-for="file in snapshot.files" :key="file.filename" type="button" :aria-pressed="filename === file.filename" :disabled="busy" @click="loadFile(file.filename)">{{ file.filename }}</button><p v-if="!snapshot.files.length">{{ t('flowsNoBlueprints') }}</p><button type="button" :disabled="busy" @click="newFile">+ {{ t('flowsNewBlueprint') }}</button></div><form class="flow-editbody" @submit.prevent="request('validate')"><label for="flow-filename">{{ t('flowsFilename') }}</label><input id="flow-filename" v-model="filename" :disabled="busy" :readonly="existing" required pattern="[A-Za-z0-9][A-Za-z0-9._-]*\.ya?ml" placeholder="purchase.yaml" @input="changed"><label for="flow-yaml">{{ t('flowsYamlSource') }}</label><textarea id="flow-yaml" v-model="source" :disabled="busy" required spellcheck="false" aria-describedby="flow-editor-help" @input="changed"></textarea><p id="flow-editor-help">{{ t('flowsEditorHelp') }}</p><div class="flow-editor-actions"><button type="submit" :disabled="busy || !filename || !source">{{ t('flowsValidate') }}</button><button type="button" :disabled="busy || !valid" @click="request('save')">{{ t('flowsSave') }}</button><button v-if="existing" type="button" :disabled="busy" @click="loadFile(filename, true)">{{ t('flowsReloadDraft') }}</button></div><p v-if="status" role="status" :class="{ 'flow-warning': status === 'flowsConflict' || status === 'flowsNetworkError' }">{{ t(status) }}</p><ul v-if="diagnostics.length" class="flow-validation" role="status"><li v-for="(diagnostic, index) in diagnostics" :key="index"><code v-if="diagnosticLocation(diagnostic)">{{ diagnosticLocation(diagnostic) }}</code> {{ translateMessage(locale, diagnostic) }}</li></ul></form></div></section>
      </template>
      <footer class="flow-footer"><span>{{ t('flowsSources', { count: activeSources }) }}</span><span>{{ t('flowsRevision', { revision: snapshot.revision }) }}</span></footer>
    </template>
  </section>
</template>

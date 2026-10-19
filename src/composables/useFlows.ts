import { onMounted, onUnmounted, ref, shallowRef } from 'vue';
import type { FlowInstance, FlowSnapshot } from '../../shared/flow-types';
import type { LogMessage } from '../../shared/types';
import { createFlowAnalysis, type FlowWorkerLike } from '../flow-analysis';
import { uiMessage, type UiMessage } from '../i18n';

export function useFlows() {
  const snapshot = shallowRef<FlowSnapshot | null>(null);
  const instances = shallowRef<FlowInstance[]>([]);
  const gapCount = ref(0), loading = ref(false), error = shallowRef<UiMessage>();
  let requestedRevision = '', acknowledgedRevision = '', disposed = false, fetching = false;
  let serverSnapshot: FlowSnapshot | null = null;
  let cold: LogMessage[] = [], coldGap = false;
  let polling: ReturnType<typeof setInterval>, ticking: ReturnType<typeof setInterval>;
  const controller = new AbortController();
  const analysis = createFlowAnalysis(() => new Worker(new URL('../flow-worker.ts', import.meta.url), { type: 'module' }) as unknown as FlowWorkerLike, {
    state(value) { instances.value = value.instances; gapCount.value = value.gaps; },
    error() { error.value = uiMessage('flowsWorkerError'); loading.value = false; },
    activated(revision) {
      acknowledgedRevision = revision;
      if (serverSnapshot?.revision === revision) { snapshot.value = serverSnapshot; loading.value = false; }
    },
  });
  async function reload() {
    if (fetching || disposed) return;
    fetching = true; if (!snapshot.value) loading.value = true;
    try {
      const response = await fetch('/api/flows/snapshot', { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json() as FlowSnapshot;
      if (disposed) return;
      serverSnapshot = result;
      if (!result.enabled) { snapshot.value = result; loading.value = false; cold = []; }
      else if (result.revision === acknowledgedRevision) { snapshot.value = result; loading.value = false; }
      else {
        // File drafts may refresh immediately, but active definitions/revision wait for ACK.
        snapshot.value = { ...result, revision: acknowledgedRevision, blueprints: snapshot.value?.blueprints ?? [] };
        if (result.revision !== requestedRevision) {
          loading.value = true;
          analysis.snapshot(result.blueprints, result.revision); requestedRevision = result.revision;
          if (coldGap) analysis.gap();
          analysis.ingest(cold); cold = []; coldGap = false;
        }
      }
      if (error.value?.code === 'flowsNetworkError') error.value = undefined;
    } catch { if (!disposed) { error.value = uiMessage('flowsNetworkError'); loading.value = false; } }
    finally { fetching = false; }
  }
  function ingest(messages: LogMessage[]) {
    if (snapshot.value?.enabled) analysis.ingest(messages);
    else if (!snapshot.value) {
      cold.push(...messages);
      let bytes = cold.reduce((sum, message) => sum + message.message.length * 2, 0);
      while (cold.length > 1000 || bytes > 2 * 1024 * 1024) { bytes -= cold.shift()!.message.length * 2; coldGap = true; }
    }
  }
  function restart() { error.value = undefined; analysis.restart(); }
  function clear() { cold = []; coldGap = false; analysis.clear(); }
  function interrupt() { cold = []; coldGap = false; analysis.interrupt(); }
  function focus() { void reload(); if (snapshot.value?.enabled) analysis.tick(); }
  onMounted(() => { window.addEventListener('focus', focus); void reload(); polling = setInterval(() => { void reload(); }, 3000); ticking = setInterval(() => { if (snapshot.value?.enabled) analysis.tick(); }, 500); });
  onUnmounted(() => { window.removeEventListener('focus', focus); disposed = true; controller.abort(); clearInterval(polling); clearInterval(ticking); analysis.dispose(); });
  return { snapshot, instances, gapCount, loading, error, reload, ingest, restart, clear, interrupt, gap: analysis.gap };
}

import { createFlowAnalysis, type FlowWorkerLike } from '../src/flow-analysis';
import type { FlowEngineState, FlowSnapshot } from '../shared/flow-types';
import type { LogMessage } from '../shared/types';
import type { UiMessage } from '../src/i18n';

/** Session recognition uses the web worker's bounded queue, watchdog and epoch barriers. */
export function createTuiFlows(options: { load(): Promise<FlowSnapshot>; pollMs?: number; worker?: () => FlowWorkerLike }) {
  let snapshot: FlowSnapshot | undefined;
  let state: FlowEngineState = { instances: [], gaps: 0 };
  let error: UiMessage | undefined;
  let loading = false, disposed = false, workerFailed = false, revision = '';
  let pending: Promise<void> | undefined;
  let poll: ReturnType<typeof setTimeout> | undefined;
  let cold: LogMessage[] = [], coldBytes = 0, coldGap = false;
  const listeners = new Set<() => void>();
  const notify = () => { if (!disposed) for (const listener of listeners) listener(); };
  // Bun resolves .js to .ts in source mode; compiled multi-entry workers use .js.
  const analysis = createFlowAnalysis(options.worker ?? (() => new Worker(new URL('./flow-worker.js', import.meta.url)) as unknown as FlowWorkerLike), {
    state(value) { state = value; notify(); },
    error() { workerFailed = true; loading = false; notify(); },
    activated() { loading = false; notify(); },
  });
  function reload(): Promise<void> {
    if (disposed) return Promise.resolve();
    if (pending) return pending;
    clearTimeout(poll);
    if (!snapshot) loading = true;
    notify();
    pending = Promise.resolve().then(async () => {
      try {
        const next = await options.load();
        if (disposed) return;
        if (next.revision !== revision || !snapshot) {
          loading = true;
          analysis.snapshot(next.enabled ? next.blueprints : [], next.revision, {
            sourceIds: next.sourceIds, sourceGenerations: next.sourceGenerations,
            inactiveSources: next.inactiveSources, conflictedBlueprintIds: next.conflictedBlueprintIds,
          });
          revision = next.revision;
        }
        snapshot = next;
        if (error?.code === 'flowsNetworkError') error = undefined;
        if (coldGap) analysis.gap();
        analysis.ingest(cold); cold = []; coldBytes = 0; coldGap = false;
      } catch { if (!disposed) { error = { code: 'flowsNetworkError' }; loading = false; } }
      finally {
        pending = undefined;
        if (!disposed && (options.pollMs ?? 3000) > 0) poll = setTimeout(() => { void reload(); }, options.pollMs ?? 3000);
        notify();
      }
    });
    return pending;
  }
  const tick = setInterval(() => { if (snapshot?.enabled && !disposed) analysis.tick(); }, 500);
  return {
    get snapshot() { return snapshot; }, get state() { return state; }, get error(): UiMessage | undefined { return workerFailed ? { code: 'flowsWorkerError' } : error; }, get loading() { return loading; },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    reload,
    ingest(messages: LogMessage[]) {
      if (disposed) return;
      if (messages.some(row => row.truncated)) { if (snapshot) analysis.gap(); else coldGap = true; }
      if (snapshot?.enabled) analysis.ingest(messages);
      else if (!snapshot) {
        cold.push(...messages); coldBytes += messages.reduce((sum, row) => sum + row.message.length * 2, 0);
        while (cold.length > 1000 || coldBytes > 2 * 1024 * 1024) { coldBytes -= cold.shift()!.message.length * 2; coldGap = true; }
      }
    },
    gap() { if (!disposed) { if (!snapshot) coldGap = true; else analysis.gap(); } },
    interrupt() { if (!disposed) { cold = []; coldBytes = 0; coldGap = false; analysis.interrupt(); } },
    clear() { if (!disposed) { cold = []; coldBytes = 0; coldGap = false; analysis.clear(); } },
    restart() { if (!disposed) { workerFailed = false; analysis.restart(); notify(); } },
    dispose() { disposed = true; clearTimeout(poll); clearInterval(tick); analysis.dispose(); listeners.clear(); cold = []; },
  };
}
export type TuiFlows = ReturnType<typeof createTuiFlows>;

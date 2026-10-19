import type { FlowBlueprint, FlowEngineState } from '../shared/flow-types';
import type { LogMessage } from '../shared/types';
export type FlowCommand = { type: 'snapshot'; blueprints: FlowBlueprint[]; revision: string } | { type: 'ingest'; messages: LogMessage[] } | { type: 'clear' | 'interrupt' | 'gap' | 'tick' };
export interface FlowWorkerLike { postMessage(message: FlowCommand & { id: number }): void; terminate(): void; onmessage: ((event: { data: { id: number; state?: FlowEngineState; error?: string; activatedRevision?: string } }) => void) | null; onerror: (() => void) | null }
/** One bounded job in flight, epoch barrier for Clear, watchdog for hostile regex. */
export function createFlowAnalysis(connect: () => FlowWorkerLike, callbacks: { state(value: FlowEngineState): void; error(): void; activated?(revision: string): void }) {
  let worker: FlowWorkerLike | undefined, queue: (FlowCommand & { id: number })[] = [], id = 0, barrier = 0;
  let busy = false, failed = false, disposed = false;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let scheduling: ReturnType<typeof setTimeout> | undefined;
  let snapshot: Extract<FlowCommand, { type: 'snapshot' }> | undefined;
  function fail() { failed = true; busy = false; queue = []; clearTimeout(watchdog); worker?.terminate(); worker = undefined; callbacks.error(); }
  function pump() {
    scheduling = undefined;
    if (busy || !worker || !queue.length || disposed || failed) return;
    const job = queue.shift()!;
    busy = true;
    watchdog = setTimeout(fail, 3000);
    try { worker.postMessage(job); } catch { fail(); }
  }
  function schedule() { if (scheduling === undefined) scheduling = setTimeout(pump, 0); }
  function start() {
    if (disposed) return;
    worker = connect();
    const current = worker;
    current.onmessage = event => {
      if (worker !== current || disposed) return;
      clearTimeout(watchdog); busy = false;
      if (event.data.error) { fail(); return; }
      if (event.data.activatedRevision !== undefined) callbacks.activated?.(event.data.activatedRevision);
      if (event.data.id >= barrier && event.data.state) callbacks.state(event.data.state);
      schedule();
    };
    current.onerror = () => { if (worker === current && !disposed) fail(); };
  }
  function enqueue(command: FlowCommand) { if (!disposed && !failed && (snapshot || command.type === 'snapshot')) { queue.push({ ...command, id: ++id }); schedule(); } }
  return {
    snapshot(blueprints: FlowBlueprint[], revision: string) {
      snapshot = { type: 'snapshot', blueprints, revision };
      if (!worker && !failed) { try { start(); } catch { fail(); return; } }
      enqueue(snapshot);
    },
    ingest(messages: LogMessage[]) {
      if (!snapshot || !messages.length || failed || disposed) return;
      const waiting = queue.reduce((sum, command) => sum + (command.type === 'ingest' ? command.messages.length : 0), 0);
      const bytes = (records: LogMessage[]) => records.reduce((sum, message) => sum + message.message.length * 2, 0);
      const queuedBytes = queue.reduce((sum, command) => sum + (command.type === 'ingest' ? bytes(command.messages) : 0), 0);
      if (waiting + messages.length > 4000 || queuedBytes + bytes(messages) > 4 * 1024 * 1024) {
        queue = queue.filter(command => command.type !== 'ingest');
        enqueue({ type: 'gap' });
        messages = messages.slice(-4000);
        let size = bytes(messages);
        while (size > 4 * 1024 * 1024 && messages.length) { size -= messages[0].message.length * 2; messages = messages.slice(1); }
      }
      for (let i = 0; i < messages.length; i += 200) enqueue({ type: 'ingest', messages: messages.slice(i, i + 200) });
    },
    clear() { queue = queue.filter(command => command.type === 'snapshot'); barrier = id + 1; enqueue({ type: 'clear' }); callbacks.state({ instances: [], gaps: 0 }); },
    interrupt() { enqueue({ type: 'interrupt' }); },
    gap() { enqueue({ type: 'gap' }); },
    tick() { if (!queue.some(command => command.type === 'tick')) enqueue({ type: 'tick' }); },
    restart() { worker?.terminate(); worker = undefined; clearTimeout(watchdog); busy = false; failed = false; queue = []; barrier = id + 1; callbacks.state({ instances: [], gaps: 0 }); try { start(); } catch { fail(); return; } if (snapshot) enqueue(snapshot); },
    dispose() { disposed = true; queue = []; clearTimeout(watchdog); clearTimeout(scheduling); worker?.terminate(); worker = undefined; },
  };
}

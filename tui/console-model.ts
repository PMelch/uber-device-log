import type { Device } from '../shared/types';
import type { ConsoleResult, ConsoleState, ConsoleValue, ConsoleErrorCode } from '../shared/console';
import type { RuntimeConsole } from '../server/runtime-console';
export type ConsoleLease = { runtime: Pick<RuntimeConsole, 'enable' | 'state' | 'evaluate' | 'properties' | 'releaseOwner'>; release(): void };
export type AcquireConsole = (device: Device) => Promise<ConsoleLease>;
export type TuiConsoleResult = ConsoleResult & { expression: string; generation: number };
export function createConsoleModel(acquire: AcquireConsole, changed: () => void) {
  let cancelOpening: (() => void) | undefined;
  let lease: ConsoleLease | undefined, generation = 0, disposed = false;
  let state: ConsoleState = { revision: 0, connected: false, contexts: [] };
  let context = '', busy = false, connecting = false, error: ConsoleErrorCode | undefined;
  let results: TuiConsoleResult[] = [], history: string[] = [];
  const owner = crypto.randomUUID();
  const report = (reason: unknown) => {
    const code = (reason as { code?: ConsoleErrorCode })?.code;
    error = code && ['consoleUnavailable', 'consoleStale', 'consoleTimeout', 'consoleBusy', 'consoleInvalid'].includes(code) ? code : 'consoleUnavailable';
  };
  const release = () => { lease?.runtime.releaseOwner(owner); lease?.release(); lease = undefined; };
  function poll() {
    if (!lease || disposed) return;
    const next = lease.runtime.state();
    if (context && (next.revision !== state.revision || !next.contexts.some(c => c.key === context) || !next.connected)) { context = ''; error = 'consoleStale'; }
    const different = JSON.stringify(next) !== JSON.stringify(state);
    state = next; if (different) changed();
  }
  return {
    get state() { return state; }, get context() { return context; }, get busy() { return busy; },
    get connecting() { return connecting; }, get error() { return error; }, get results() { return results; }, get history() { return history; },
    poll, isCurrent(result: TuiConsoleResult) { return result.generation === generation && result.revision === state.revision; },
    async connect(device: Device) {
      if (disposed || !device.webview) return;
      cancelOpening?.(); cancelOpening = undefined;
      const version = ++generation; release(); context = ''; error = undefined; connecting = true; busy = false;
      state = { revision: 0, connected: false, contexts: [] }; changed();
      let acquired: ConsoleLease | undefined, expired = false;
      let deadline: ReturnType<typeof setTimeout> | undefined;
      try {
        acquired = await Promise.race([
          acquire(device).then(value => { if (expired) { value.release(); throw { code: 'consoleTimeout' }; } return value; }),
          new Promise<never>((_resolve, reject) => { cancelOpening = () => { expired = true; clearTimeout(deadline); reject({ code: 'consoleTimeout' }); }; deadline = setTimeout(cancelOpening, 15000); }),
        ]);
        clearTimeout(deadline); if (version === generation) cancelOpening = undefined;
        if (disposed || version !== generation) { acquired.release(); return; }
        lease = acquired; await acquired.runtime.enable();
        if (!disposed && version === generation) { state = acquired.runtime.state(); changed(); }
      } catch (e) { if (!disposed && version === generation) { release(); report(e); } }
      finally { clearTimeout(deadline); if (!disposed && version === generation) { connecting = false; changed(); } }
    },
    chooseContext(key: string) { poll(); if (state.contexts.some(c => c.key === key)) { context = key; error = undefined; changed(); } },
    async execute(expression: string) {
      poll();
      if (disposed || !lease || !context || !state.connected || connecting || busy || !expression.trim()) return;
      const version = generation, active = lease;
      busy = true; error = undefined; history = [expression, ...history.filter(item => item !== expression)].slice(0, 50); changed();
      try {
        const result = await active.runtime.evaluate(context, state.revision, expression, owner);
        if (!disposed && version === generation) results = [...results, { ...result, expression, generation: version }].slice(-50);
      } catch (e) { if (!disposed && version === generation) { report(e); if (error === 'consoleStale') context = ''; } }
      finally { if (!disposed && version === generation) { busy = false; changed(); } }
    },
    async inspect(result: TuiConsoleResult, value: ConsoleValue, offset = 0) {
      poll();
      if (!lease || !value.handle || disposed || result.generation !== generation || result.revision !== state.revision || !results.includes(result)) throw { code: 'consoleStale' };
      const version = generation;
      const page = await lease.runtime.properties(value.handle, result.revision, offset, owner);
      if (disposed || version !== generation || !results.includes(result) || result.revision !== lease?.runtime.state().revision) throw { code: 'consoleStale' };
      return page;
    },
    clear() { if (busy || disposed) return; lease?.runtime.releaseOwner(owner); results = []; error = undefined; changed(); },
    dispose() { disposed = true; generation++; cancelOpening?.(); cancelOpening = undefined; release(); },
  };
}

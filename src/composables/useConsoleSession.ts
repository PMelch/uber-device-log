import { onMounted, onUnmounted, ref, watch, type Ref } from 'vue';
import type { ConsoleErrorCode, ConsoleState } from '../../shared/console';
import type { LogSource } from '../../shared/types';

const errors = new Set<ConsoleErrorCode>(['consoleUnavailable', 'consoleStale', 'consoleTimeout', 'consoleBusy', 'consoleInvalid']);

export async function consoleRequest(path: string, body?: unknown, method?: string) {
  const response = await fetch(`/api/console${path}`, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 204) return;
  const data = await response.json();
  if (!response.ok) throw errors.has(data.code) ? data.code : 'consoleUnavailable';
  return data;
}

function release(id: string) {
  if (id) void fetch(`/api/console/${id}`, { method: 'DELETE', keepalive: true }).catch(() => {});
}

export function useConsoleSession(target: Readonly<Ref<LogSource | undefined>>) {
  const session = ref('');
  const state = ref<ConsoleState>({ revision: 0, connected: false, contexts: [] });
  const context = ref('');
  const error = ref<ConsoleErrorCode>();
  const connecting = ref(false);
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function report(cause: unknown) {
    error.value = errors.has(cause as ConsoleErrorCode) ? cause as ConsoleErrorCode : 'consoleUnavailable';
  }

  function apply(next: ConsoleState) {
    if (context.value && (next.revision !== state.value.revision || !next.contexts.some(c => c.key === context.value))) {
      context.value = '';
      error.value = 'consoleStale';
    }
    state.value = next;
  }

  async function poll(token: string, version: number) {
    try {
      const next = await consoleRequest(`/${token}`);
      if (version === generation) apply(next);
    } catch (cause) {
      if (version === generation) {
        report(cause);
        state.value.connected = false;
        context.value = '';
      }
    }
    if (version === generation) timer = setTimeout(() => void poll(token, version), 1000);
  }

  function close() {
    ++generation;
    clearTimeout(timer);
    release(session.value);
    session.value = '';
    context.value = '';
    connecting.value = false;
    state.value = { revision: 0, connected: false, contexts: [] };
  }

  async function connect() {
    close();
    const version = generation;
    const device = target.value?.device;
    if (!device?.webview) {
      error.value = 'consoleUnavailable';
      return;
    }
    error.value = undefined;
    connecting.value = true;
    try {
      const next = await consoleRequest('', {
        platform: device.platform, id: device.id, socket: device.webview.socket, target: device.webview.id,
      });
      if (version !== generation) {
        release(next.id);
        return;
      }
      session.value = next.id;
      apply(next);
      void poll(next.id, version);
    } catch (cause) {
      if (version === generation) report(cause);
    } finally {
      if (version === generation) connecting.value = false;
    }
  }

  watch(() => target.value?.key, connect);
  onMounted(connect);
  onUnmounted(close);
  return { session, state, context, connecting, error, report, connect };
}

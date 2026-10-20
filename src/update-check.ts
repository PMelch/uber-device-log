export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string | null;
  installation: 'npx' | 'bunx' | 'npm-global' | 'bun-global' | 'unknown';
  commands: string[];
  changelogUrl: string | null;
  status: 'checking' | 'available' | 'current' | 'unavailable';
}
interface PollDependencies {
  fetch: (url: string, options: { signal: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<UpdateInfo> }>;
  schedule: (callback: () => void) => ReturnType<typeof setTimeout>;
  cancel: (timer: ReturnType<typeof setTimeout>) => void;
}
/** Discovery is independent of device capture. Failed checks stay silent. */
export function pollForUpdate(receive: (info: UpdateInfo) => void, dependencies: PollDependencies = {
  fetch: (url, options) => fetch(url, options),
  schedule: callback => setTimeout(callback, 1000),
  cancel: timer => clearTimeout(timer),
}) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function check() {
    try {
      const response = await dependencies.fetch('/api/update', { signal: controller.signal });
      if (!response.ok || controller.signal.aborted) return;
      const result = await response.json();
      if (controller.signal.aborted) return;
      if (result.status === 'checking') timer = dependencies.schedule(() => { void check(); });
      else if (result.status === 'available') receive(result);
    } catch { /* Version checks must never interrupt log capture. */ }
  }
  void check();
  return () => {
    controller.abort();
    if (timer !== undefined) dependencies.cancel(timer);
  };
}

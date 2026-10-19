import { resolve } from 'node:path';

export type Installation = 'npx' | 'bunx' | 'npm-global' | 'bun-global' | 'unknown';

/** Infer from the executing package location, not an unrelated parent's package manager. */
export function detectInstallation(packageRoot: string, env: NodeJS.ProcessEnv): Installation {
  const path = packageRoot.replaceAll('\\', '/');
  const within = (directory: string | undefined) => directory && path === resolve(directory, 'node_modules/uber-device-log').replaceAll('\\', '/');
  if (within(env.BUN_INSTALL_GLOBAL_DIR) || /\/\.bun\/install\/global\/node_modules\/uber-device-log$/.test(path)) return 'bun-global';
  if (/\/_npx\/[^/]+\/node_modules\/uber-device-log$/.test(path)) return 'npx';
  if (/\/bunx-\d+-uber-device-log(?:@[^/]+)?\/node_modules\/uber-device-log$/.test(path)
      || /\/\.bun\/install\/cache\/uber-device-log@[^/]+$/.test(path)) return 'bunx';
  if (within(env.npm_config_prefix && resolve(env.npm_config_prefix, 'lib'))
      || within(env.npm_config_prefix)
      || /\/lib\/node_modules\/uber-device-log$/.test(path)
      || /\/AppData\/Roaming\/npm\/node_modules\/uber-device-log$/i.test(path)) return 'npm-global';
  return 'unknown';
}

const commands: Record<Exclude<Installation, 'unknown'>, string> = {
  npx: 'npx --yes uber-device-log@latest',
  bunx: 'bunx uber-device-log@latest',
  'npm-global': 'npm install -g uber-device-log@latest',
  'bun-global': 'bun install -g uber-device-log@latest',
};
export function updateCommands(installation: Installation): string[] {
  return installation === 'unknown' ? Object.values(commands) : [commands[installation]];
}

function versionParts(version: string) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(version);
  return match && { core: match.slice(1, 4).map(BigInt), prerelease: match[4] };
}
/** The registry's latest channel must resolve to a stable version. */
export function isNewerVersion(current: string, latest: string): boolean {
  const a = versionParts(current), b = versionParts(latest);
  if (!a || !b || b.prerelease) return false;
  for (let i = 0; i < 3; i++) {
    if (a.core[i] !== b.core[i]) return b.core[i]! > a.core[i]!;
  }
  return !!a.prerelease;
}

export function createUpdateCheck(currentVersion: string, installation: Installation,
  request: typeof fetch = fetch, timeoutMs = 4000) {
  const state = {
    currentVersion, latestVersion: null as string | null, installation,
    commands: updateCommands(installation), changelogUrl: null as string | null,
    status: 'checking' as 'checking' | 'available' | 'current' | 'unavailable',
  };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error('Update check timed out')); }, timeoutMs);
  });
  const done = (async () => {
    try {
      const version = await Promise.race([timeout, (async () => {
        const response = await request('https://registry.npmjs.org/uber-device-log/latest', {
          signal: controller.signal, headers: { Accept: 'application/json' }, redirect: 'error',
        });
        if (!response.ok) throw new Error('Registry unavailable');
        const data: unknown = await response.json();
        if (!data || typeof data !== 'object' || !('version' in data) || typeof data.version !== 'string'
            || data.version.length > 128 || !versionParts(data.version) || versionParts(data.version)!.prerelease) throw new Error('Invalid registry version');
        return data.version;
      })()]);
      state.status = isNewerVersion(currentVersion, version) ? 'available' : 'current';
      state.latestVersion = version;
      if (state.status === 'available') state.changelogUrl = 'https://github.com/PMelch/uber-device-log/blob/main/CHANGELOG.txt';
    } catch {
      state.status = 'unavailable';
    } finally {
      clearTimeout(timer!);
    }
  })();
  return { state, done };
}

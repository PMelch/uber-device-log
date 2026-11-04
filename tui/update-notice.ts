import { createUpdateCheck } from '../server/update-check';

/** The terminal app is built from source; npm update commands do not install it. */
export interface TuiUpdateNotice {
  currentVersion: string;
  latestVersion: string;
  changelogUrl: string;
}

/** One bounded startup request; unavailable checks never interrupt capture. */
export function createTuiUpdateNotice(currentVersion: string, notify: (notice: TuiUpdateNotice) => void,
  request: typeof fetch = fetch, timeoutMs = 4000) {
  let disposed = false;
  const check = createUpdateCheck(currentVersion, 'unknown', request, timeoutMs);
  const done = check.done.then(() => {
    const { state } = check;
    if (!disposed && state.status === 'available' && state.latestVersion && state.changelogUrl) {
      notify({ currentVersion, latestVersion: state.latestVersion, changelogUrl: state.changelogUrl });
    }
  });
  return { done, dispose() { disposed = true; check.cancel(); } };
}

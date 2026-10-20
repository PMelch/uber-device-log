interface PreferenceDependencies {
  storage: () => Pick<Storage, 'getItem' | 'setItem'>;
  now: () => number;
}
type Preference = { dismissed: true } | { until: number };
const reminderDelay = 24 * 60 * 60 * 1000;

/** Exact version keys ensure an ignored release never hides a newer release. */
export function createUpdatePreference(dependencies: PreferenceDependencies = {
  storage: () => window.localStorage,
  now: () => Date.now(),
}) {
  const fallback = new Map<string, Preference>();
  const key = (version: string) => 'uber-device-log.update.' + version;
  return {
    hide(version: string, action: 'later' | 'dismiss') {
      const preference: Preference = action === 'dismiss' ? { dismissed: true } : { until: dependencies.now() + reminderDelay };
      try {
        dependencies.storage().setItem(key(version), JSON.stringify(preference));
        fallback.delete(version);
      } catch { fallback.set(version, preference); /* Session actions still work. */ }
    },
    isHidden(version: string): boolean {
      let preference: unknown = fallback.get(version);
      if (!preference) {
        try { preference = JSON.parse(dependencies.storage().getItem(key(version)) ?? 'null'); }
        catch { return false; }
      }
      if (!preference || typeof preference !== 'object' || Array.isArray(preference)) return false;
      if ('dismissed' in preference && preference.dismissed === true) return true;
      return 'until' in preference && typeof preference.until === 'number'
        && Number.isFinite(preference.until) && preference.until > dependencies.now();
    },
  };
}

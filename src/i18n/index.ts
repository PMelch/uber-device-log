import { computed, ref, watch } from 'vue';
import { interpolate, type MessageParams } from '../../shared/notifications';
import { en, type MessageKey, type Messages } from './en';
import { de } from './de';
import { es } from './es';
import { fr } from './fr';
import { it } from './it';
import { zhCN } from './zh-CN';

export const catalogs = { en, es, de, fr, it, 'zh-CN': zhCN } satisfies Record<string, Messages>;
export type Locale = keyof typeof catalogs;
export const languages: { code: Locale; name: string }[] = [
  { code: 'en', name: 'English' }, { code: 'es', name: 'Español' },
  { code: 'de', name: 'Deutsch' }, { code: 'fr', name: 'Français' },
  { code: 'it', name: 'Italiano' }, { code: 'zh-CN', name: '简体中文' },
];
export const languageStorageKey = 'uber-device-log.language';
export interface UiMessage { code: MessageKey; params?: MessageParams; message?: string }
export const uiMessage = (code: MessageKey, params?: MessageParams): UiMessage => ({ code, params });

export function resolveLocale(saved: string | null, preferred: readonly string[]): Locale {
  if (saved && Object.hasOwn(catalogs, saved)) return saved as Locale;
  for (const language of preferred) {
    const base = language.toLowerCase().split(/[-_]/)[0];
    if (base === 'zh') return 'zh-CN';
    if (Object.hasOwn(catalogs, base)) return base as Locale;
  }
  return 'en';
}
export function translate(locale: Locale, key: MessageKey, params: MessageParams = {}): string {
  const localized = Object.fromEntries(Object.entries(params).map(([name, value]) => [
    name, typeof value === 'number' ? new Intl.NumberFormat(locale).format(value) : value,
  ]));
  return interpolate(catalogs[locale][key] ?? en[key], localized);
}
/** Unknown/older server messages retain their diagnostic fallback verbatim. */
export function translateMessage(locale: Locale, value: UiMessage | { code?: string; params?: MessageParams; message?: string } | string): string {
  if (typeof value === 'string') return value;
  return value.code && Object.hasOwn(en, value.code)
    ? translate(locale, value.code as MessageKey, value.params)
    : value.message ?? '';
}
const deviceStates: Record<string, MessageKey> = {
  connected: 'stateConnected', offline: 'stateOffline', unauthorized: 'stateUnauthorized',
  authorizing: 'stateAuthorizing', disconnected: 'stateDisconnected', bootloader: 'stateBootloader',
  recovery: 'stateRecovery', sideload: 'stateSideload', 'no permissions': 'stateNoPermissions',
};
const levelKeys: Record<string, MessageKey> = {
  VERBOSE: 'levelVerbose', DEBUG: 'levelDebug', INFO: 'levelInfo', WARN: 'levelWarn', ERROR: 'levelError', FATAL: 'levelFatal',
};

export function useI18n() {
  let saved: string | null = null;
  try { if (typeof window !== 'undefined') saved = window.localStorage.getItem(languageStorageKey); } catch { /* Storage can be blocked. */ }
  const locale = ref(resolveLocale(saved, typeof window !== 'undefined' ? window.navigator.languages : []));
  const numberFormat = computed(() => new Intl.NumberFormat(locale.value));
  const t = (key: MessageKey, params?: MessageParams) => translate(locale.value, key, params);
  watch(locale, value => {
    if (typeof document !== 'undefined') document.documentElement.lang = value;
  }, { immediate: true, flush: 'sync' });
  function setLocale(value: Locale) {
    locale.value = value;
    try { window.localStorage.setItem(languageStorageKey, value); } catch { /* Still works for this session. */ }
  }
  return {
    locale, setLocale, languages, t,
    languageName: computed(() => languages.find(language => language.code === locale.value)!.name),
    n: (value: number) => numberFormat.value.format(value),
    localizeMessage: (value: Parameters<typeof translateMessage>[1]) => translateMessage(locale.value, value),
    deviceState: (state: string) => t(deviceStates[state] ?? 'stateUnknown', { detail: state }),
    levelLabel: (level: string) => levelKeys[level] ? t(levelKeys[level]) : level,
  };
}

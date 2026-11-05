import { catalogs, languageStorageKey } from '../src/i18n';

/** Inline only the small startup copy, so the first paint never waits for Vue. */
export function startupHtml(html: string): string {
  const labels = Object.fromEntries(Object.entries(catalogs).map(([locale, messages]) => [locale, messages.appLoading]));
  const script = `(() => {
    const labels = ${JSON.stringify(labels).replaceAll('<', '\\u003c')};
    let saved;
    try { saved = localStorage.getItem(${JSON.stringify(languageStorageKey)}); } catch {}
    const locale = saved && Object.hasOwn(labels, saved) ? saved :
      (navigator.languages || [navigator.language]).map(language => {
        const base = language.toLowerCase().split(/[-_]/)[0];
        return base === 'zh' ? 'zh-CN' : base;
      }).find(language => Object.hasOwn(labels, language)) || 'en';
    const label = document.getElementById('app-startup');
    if (label) { label.textContent = labels[locale]; label.lang = locale; }
  })();`;
  return html.replace('<!--app-loading-label-->', catalogs.en.appLoading)
    .replace('<!--app-loading-script-->', `<script>${script}</script>`);
}

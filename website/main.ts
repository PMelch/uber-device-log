import './style.css';
import { websiteLanguages as languages, websiteLocale as resolveLocale, websiteTranslate as translate, type WebsiteLocale as Locale, type WebsiteKey as MessageKey } from '../src/i18n/website';
let saved: string | null = null;
try { saved = localStorage.getItem('udl.website.language'); } catch {}
let locale = resolveLocale(saved, navigator.languages);
const language = document.querySelector<HTMLSelectElement>('#language')!;
for (const item of languages) language.add(new Option(item.name, item.code));
function render() {
  document.documentElement.lang = locale;
  language.value = locale;
  for (const el of document.querySelectorAll<HTMLElement>('[data-t]')) el.textContent = translate(locale, el.dataset.t as MessageKey);
  for (const el of document.querySelectorAll<HTMLElement>('[data-alt]')) el.setAttribute('alt', translate(locale, el.dataset.alt as MessageKey));
  for (const el of document.querySelectorAll<HTMLElement>('[data-label]')) el.setAttribute('aria-label', translate(locale, el.dataset.label as MessageKey));
  document.querySelector('#copy-status')!.textContent = '';
  document.title = `Über Device Log — ${translate(locale, 'siteHero')} ${translate(locale, 'siteHeroAccent')}`;
}
language.addEventListener('change', () => { locale = language.value as Locale; try { localStorage.setItem('udl.website.language', locale); } catch {} render(); });
const command = document.querySelector<HTMLElement>('#install-command')!;
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-command]')) button.addEventListener('click', () => {
  for (const other of document.querySelectorAll<HTMLButtonElement>('[data-command]')) { other.classList.toggle('active', other === button); other.setAttribute('aria-pressed', String(other === button)); }
  command.textContent = button.dataset.command!.replace(/\\n/g, '\n');
  document.querySelector('#copy-status')!.textContent = '';
});
document.querySelector('#copy')!.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(command.textContent!); document.querySelector('#copy-status')!.textContent = translate(locale, 'siteCopied'); }
  catch { document.querySelector('#copy-status')!.textContent = translate(locale, 'siteCopyFallback'); const range = document.createRange(); range.selectNodeContents(command); getSelection()?.removeAllRanges(); getSelection()?.addRange(range); }
});
render();

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectScope } from 'vue';
import { catalogs, languages, resolveLocale, translate, translateMessage, useI18n, languageStorageKey } from '../src/i18n';
import { en, type MessageKey } from '../src/i18n/en';
import { notification } from '../shared/notifications';
import { translationContext } from '../src/i18n/context';

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
test('every translated message has location, meaning and descriptions for exactly its placeholders', () => {
  assert.deepEqual(Object.keys(translationContext).sort(), Object.keys(en).sort());
  for (const key of Object.keys(en) as MessageKey[]) {
    const context = translationContext[key];
    assert.ok(context.location.trim(), `${key}: missing UI location`);
    assert.ok(context.meaning.trim(), `${key}: missing translation meaning`);
    assert.deepEqual(Object.keys(context.placeholders ?? {}).sort(), [...new Set(placeholders(en[key]))], `${key}: undocumented or stale placeholders`);
    for (const [name, description] of Object.entries(context.placeholders ?? {})) {
      assert.ok(description.trim(), `${key}.${name}: missing placeholder description`);
    }
  }
});
test('all six catalogs contain every key and preserve interpolation parameters', () => {
  assert.equal(languages.length, 6);
  for (const [locale, messages] of Object.entries(catalogs)) {
    assert.deepEqual(Object.keys(messages).sort(), Object.keys(en).sort(), locale);
    for (const key of Object.keys(en) as MessageKey[]) {
      assert.ok(messages[key].trim(), `${locale}.${key}`);
      assert.deepEqual(placeholders(messages[key]), placeholders(en[key]), `${locale}.${key}`);
    }
  }
});
test('saved language wins, regional preferences resolve in order, unsupported languages fall back to English', () => {
  assert.equal(resolveLocale('fr', ['de-AT']), 'fr');
  assert.equal(resolveLocale(null, ['pt-BR', 'es-MX', 'en']), 'es');
  assert.equal(resolveLocale('invalid', ['de-AT']), 'de');
  assert.equal(resolveLocale(null, ['zh-Hans-SG']), 'zh-CN');
  assert.equal(resolveLocale(null, ['zh-TW']), 'zh-CN');
  assert.equal(resolveLocale(null, ['it-CH']), 'it');
  assert.equal(resolveLocale(null, ['fr-CA']), 'fr');
  assert.equal(resolveLocale(null, ['en-US']), 'en');
  assert.equal(resolveLocale(null, ['ja-JP']), 'en');
  assert.equal(resolveLocale('constructor', []), 'en');
});
test('status descriptors can change language after receipt without changing diagnostic details', () => {
  const event = notification('streamSkipped', { count: 12000 });
  assert.match(translateMessage('de', event), /12\.000/);
  assert.match(translateMessage('en', event), /12,000/);
  assert.match(translateMessage('zh-CN', event), /已跳过消息/);
  const detail = 'EACCES <private> {count}';
  assert.ok(translateMessage('fr', notification('streamError', { platform: 'iOS', detail })).includes(detail));
  assert.equal(translateMessage('de', { code: 'future-code', message: 'Original diagnostic' }), 'Original diagnostic');
  assert.equal(translateMessage('de', 'Legacy diagnostic'), 'Legacy diagnostic');
  assert.equal(translate('es', 'copyCount', { count: 0 }), 'Copiar (0)');
});
test('language changes update existing translations, HTML language and persisted preference; blocked storage is harmless', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const scope = effectScope();
  const storage = new Map<string, string>();
  let blocked = false;
  const page = { documentElement: { lang: '' } };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: page });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    navigator: { languages: ['de-AT'] },
    localStorage: {
      getItem: (key: string) => { if (blocked) throw new Error('blocked'); return storage.get(key) ?? null; },
      setItem: (key: string, value: string) => { if (blocked) throw new Error('blocked'); storage.set(key, value); },
    },
  } });
  try {
    scope.run(() => {
      const i18n = useI18n();
      assert.equal(i18n.locale.value, 'de');
      assert.equal(page.documentElement.lang, 'de');
      i18n.setLocale('fr');
      assert.equal(i18n.t('pause'), 'Mettre en pause');
      assert.equal(page.documentElement.lang, 'fr');
      assert.equal(storage.get(languageStorageKey), 'fr');
      assert.equal(useI18n().locale.value, 'fr');
      blocked = true;
      assert.doesNotThrow(() => i18n.setLocale('zh-CN'));
      assert.equal(i18n.t('pause'), '暂停');
      assert.equal(page.documentElement.lang, 'zh-CN');
      assert.equal(useI18n().locale.value, 'de');
    });
  } finally {
    scope.stop();
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else Reflect.deleteProperty(globalThis, 'window');
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument); else Reflect.deleteProperty(globalThis, 'document');
  }
});

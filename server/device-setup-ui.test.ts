import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { catalogs, translate, type Locale } from '../src/i18n';
import { setupSteps, setupWarnings } from '../src/device-setup';
import { notification } from '../shared/notifications';
import type { DeviceSetup, DeviceSetupIssue } from '../shared/types';

const missing: DeviceSetupIssue = {platform:'android',reason:'adbMissing',detail:'spawn <custom-adb> ENOENT'};
const ios: DeviceSetupIssue = {platform:'ios',reason:'iosUnavailable',detail:'ECONNREFUSED 127.0.0.1:27015'};
test('commands match the host and authorization problems do not suggest reinstalling ADB', () => {
  const commands = (host: DeviceSetup['host'], issue: DeviceSetupIssue) => setupSteps(host,issue).flatMap(step=>step.commands ?? []).join('\n');
  assert.match(commands('windows',missing), /& \$env:ADB_PATH devices -l/);
  assert.match(commands('macos',missing), /"\$ADB_PATH" devices -l/);
  assert.match(commands('linux',ios), /idevicepair pair/);
  assert.doesNotMatch(commands('macos',ios), /sudo|apt-get|dnf|usbmuxd/);
  assert.equal(commands('other',missing), '');
  for (const reason of ['androidUnauthorized','androidPermissions'] as const) {
    assert.ok(!setupSteps('linux',{...missing,reason}).some(step=>step.message === 'setupInstallAndroid'));
  }
});
test('structured help replaces only corresponding discovery warnings; legacy servers still work', () => {
  const warnings = [notification('discoveryUnavailable',{platform:'Android',detail:'missing'}), notification('discoveryUnavailable',{platform:'iOS',detail:'other'}), notification('webviewDiscoveryUnavailable',{device:'phone',detail:'CDP'}), 'legacy'];
  assert.deepEqual(setupWarnings(warnings), warnings);
  assert.deepEqual(setupWarnings(warnings,{host:'linux',issues:[missing]}),warnings.slice(1));
  assert.deepEqual(setupWarnings(warnings,{host:'linux',issues:[]}),warnings);
});
test('setup renders all host and language variants safely, hides healthy states and preserves source usability', async () => {
  const server = await createServer({server:{middlewareMode:true, watch:null, ws:false}});
  try {
    const {default: DeviceSetupPanel} = await server.ssrLoadModule('/src/components/DeviceSetup.vue');
    const render = (host: DeviceSetup['host'], locale: Locale, issues = [missing,ios], connected = false) => renderToString(createSSRApp({render:()=>h(DeviceSetupPanel,{
      setup:{host,issues}, connected, loading:false,
      t:(key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2])=>translate(locale,key,params),
    })}));
    for (const host of ['windows','linux','macos','other'] as const) {
      for (const locale of Object.keys(catalogs) as Locale[]) {
        const html = await render(host,locale);
        assert.ok(html.includes(translate(locale,'setupTitle')));
        assert.ok(html.includes(translate(locale,'setupCopy')));
        assert.ok(html.includes('aria-hidden="true"'));
        assert.ok(!html.includes('spawn <custom-adb>'));
        assert.ok(html.includes('spawn &lt;custom-adb&gt; ENOENT'));
      }
    }
    assert.ok(!(await render('windows','en',[])).includes('setup-overview'));
    assert.doesNotMatch((await render('windows','en',[missing],true)).match(/<details class="setup-overview"[^>]*>/)![0], /\bopen\b/);
    assert.match((await render('windows','en')).match(/<details class="setup-overview"[^>]*>/)![0], /\bopen\b/);
  } finally { await server.close(); }
});

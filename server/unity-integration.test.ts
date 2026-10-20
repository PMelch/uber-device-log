import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { filterLogLevels } from '../shared/log-view.js';
import { serializeLogExport } from '../shared/log-export.js';
import { createWebViewHub } from './webview-hub.js';
import type { Device } from '../shared/types.js';
test('Unity filters structured severity without altering multiline logs', () => {
 const rows = [{timestamp:'2026-10-20T12:00:00Z',level:'ERROR',message:'Exception: bad\n  at Game.Update()'}, {timestamp:'2026-10-20T12:00:01Z',level:'INFO',message:'ready'}];
 assert.deepEqual(filterLogLevels(rows, 'unity', ['ERROR']), [rows[0]]);
 const device:Device={platform:'unity',id:'project/editor',name:'Unity Editor',state:'connected'};
 assert.ok(serializeLogExport(rows,device,'text','bottom').text.includes(rows[0]!.message));
});
test('Unity cannot acquire a JavaScript console even with forged WebView metadata', async()=>{
 let opened=false; const acquire=createWebViewHub(async()=>{opened=true;return()=>{};});
 await assert.rejects(acquire({platform:'unity',id:'editor',name:'Unity',state:'connected'}));
 assert.equal(opened,false);
});
test('bundled Unity routes participate in discovery, capture and shutdown',()=>{
 const source=readFileSync(new URL('./index.ts',import.meta.url),'utf8');
 for (const text of ['unityRoutes(', 'unity.devices(', 'unity.openLogs', 'unity.close(']) assert.ok(source.includes(text), text);
 const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
 assert.ok(pkg.files.includes('unity-package/'));
});

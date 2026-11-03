import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadFlowBundle } from './flow-download.js';
test('downloads bound redirects, schemes, size and response completeness', async () => {
  await assert.rejects(downloadFlowBundle('file:///tmp/a.blueprint'),/HTTP/);
  await assert.rejects(downloadFlowBundle('https://user:secret@example.test/a.blueprint'),/credentials/);
  await assert.rejects(downloadFlowBundle('https://example.test/a.zip'),/blueprint/);
  await assert.rejects(downloadFlowBundle('https://example.test/a.blueprint',async()=>new Response('',{status:302,headers:{location:'/again'}})),/redirect/);
  await assert.rejects(downloadFlowBundle('https://example.test/a.blueprint',async()=>new Response('',{status:302,headers:{location:'http://example.test/a.blueprint'}})),/HTTPS/);
  await assert.rejects(downloadFlowBundle('https://example.test/a.blueprint',async()=>new Response('tiny',{headers:{'content-length':String(4*1024*1024+1)}})),/limit/);
  await assert.rejects(downloadFlowBundle('https://example.test/a.blueprint',async()=>new Response('tiny',{headers:{'content-length':'20'}})),/truncated/);
  await assert.rejects(downloadFlowBundle('https://example.test/a.blueprint',async()=>new Response(new Uint8Array(4*1024*1024+1))),/limit/);
  let calls=0;
  const value = await downloadFlowBundle('https://example.test/a.blueprint',async()=>++calls===1 ? new Response('',{status:302,headers:{location:'https://other.test/data'}}) : new Response('data'));
  assert.equal(value.toString(),'data'); assert.equal(calls,2);
});

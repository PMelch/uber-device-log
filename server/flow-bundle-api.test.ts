import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FlowProject } from './flow-project.js';
import { fixtureBundle } from './fixtures/flow-bundle.js';
test('bundle management API protects writes and returns origin-aware activation snapshots', async () => {
  const root=await mkdtemp(join(tmpdir(),'udl-bundle-api-')); await mkdir(join(root,'home')); await mkdir(join(root,'project'));
  const project=await FlowProject.create(join(root,'project'),{home:join(root,'home'),fetch:async()=>new Response(new Uint8Array(fixtureBundle()))});
  const app=express();app.use('/api/flows',project.router());const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api/flows`;
  try {
    const before=await(await fetch(`${base}/snapshot`)).json();
    const body=JSON.stringify({url:'https://example.test/a.blueprint',scope:'global'});
    assert.equal((await fetch(`${base}/bundles/install`,{method:'POST',headers:{'content-type':'application/json'},body})).status,403);
    const headers={'content-type':'application/json','x-flow-token':before.token};
    let response=await fetch(`${base}/bundles/install`,{method:'POST',headers,body});assert.equal(response.status,200);let snapshot=await response.json();
    assert.equal(snapshot.sources.find((s:any)=>s.id==='global:bundle:sample').enabled,false);
    response=await fetch(`${base}/bundles/activation`,{method:'POST',headers,body:JSON.stringify({sourceId:'global:bundle:sample',enabled:true,revision:snapshot.configRevision})});assert.equal(response.status,200);snapshot=await response.json();
    assert.ok(snapshot.blueprints.some((b:any)=>b.id==='fixture')); assert.match(await readFile(join(root,'project/.udl/config.yaml'),'utf8'),/sample: true/);
    response=await fetch(`${base}/bundles/activation`,{method:'POST',headers,body:JSON.stringify({sourceId:'global:bundle:sample',enabled:false,revision:'stale'})});assert.equal(response.status,409);assert.equal((await response.json()).diagnostics[0].code,'flowsBundleError');
    response=await fetch(`${base}/bundles/install`,{method:'POST',headers,body});assert.equal(response.status,409);
  } finally {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true});}
});

test('successful loose save stays HTTP 200 with correct revision despite an unrelated invalid bundle', async () => {
  const { writeFile } = await import('node:fs/promises'); const { fixtureBlueprint }=await import('./fixtures/flow-bundle.js');
  const root=await mkdtemp(join(tmpdir(),'udl-save-api-'));await mkdir(join(root,'.udl/bundles'),{recursive:true});await writeFile(join(root,'.udl/bundles/broken.blueprint'),'invalid');
  const project=await FlowProject.create(root,{home:root});const app=express();app.use('/api/flows',project.router());const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api/flows`;
  try{
    const before=await(await fetch(`${base}/snapshot`)).json();
    const response=await fetch(`${base}/blueprints`,{method:'POST',headers:{'content-type':'application/json','x-flow-token':before.token},body:JSON.stringify({filename:'new.yaml',source:fixtureBlueprint('saved')})});
    assert.equal(response.status,200);const snapshot=await response.json();assert.ok(snapshot.files.find((file:any)=>file.filename==='new.yaml').revision);assert.ok(snapshot.diagnostics.length);
    assert.equal(await readFile(join(root,'.udl/flows/new.yaml'),'utf8'),fixtureBlueprint('saved'));
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true});}
});

test('binary bundle uploads require authentication, enforce limits and preserve installed files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'udl-upload-'));
  const project = await FlowProject.create(root, { home: root });
  const app = express(); app.use('/api/flows', project.router());
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/flows`;
  try {
    const { token } = await (await fetch(`${base}/snapshot`)).json();
    const upload = (body: Buffer, headers: Record<string,string> = { 'x-flow-token': token, 'content-type': 'application/octet-stream' }, scope = 'project') => fetch(`${base}/bundles/upload?scope=${scope}`, { method: 'POST', headers, body: new Uint8Array(body) });
    assert.equal((await upload(fixtureBundle(), { 'content-type': 'application/octet-stream' })).status, 403);
    assert.equal((await upload(fixtureBundle(), { 'x-flow-token': token, 'content-type': 'application/json' })).status, 403);
    assert.equal((await upload(Buffer.alloc(4 * 1024 * 1024 + 1))).status, 413);
    assert.equal((await upload(Buffer.from('invalid'))).status, 400);
    assert.equal((await upload(fixtureBundle(), undefined, 'invalid')).status, 400);
    const response = await upload(fixtureBundle());
    assert.equal(response.status, 200);
    const snapshot = await response.json();
    assert.equal(snapshot.sources.find((source: any) => source.id === 'project:bundle:sample').enabled, false);
    assert.equal((await upload(fixtureBundle())).status, 409);
    assert.deepEqual(await readFile(join(root, '.udl/bundles/sample.blueprint')), fixtureBundle());
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); }
});

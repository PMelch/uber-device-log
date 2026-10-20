import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtempSync, rmSync, readFileSync, statSync, writeFileSync, symlinkSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeProject } from './project-context.js';
import { unityRoutes } from './unity-routes.js';

async function fixture(t: test.TestContext, enabled = true) {
  const directory = mkdtempSync(join(tmpdir(), 'udl-unity-'));
  const project = enabled ? initializeProject(directory) : undefined;
  if (project) writeFileSync(project.configPath, 'unity: {enabled: true}');
  let now = 1000;
  const app = express(); const server = createServer(app);
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as {port:number}).port;
  const routes = unityRoutes(project, port, { now: () => now });
  app.use('/api/unity', routes.router);
  const origin = 'http://127.0.0.1:' + port;
  const request = (path: string, body?: unknown, headers: Record<string,string> = {}, method = body === undefined ? 'GET' : 'POST') => fetch(origin + '/api/unity' + path, {method, headers: {'Content-Type':'application/json', ...headers}, body: body === undefined ? undefined : JSON.stringify(body)});
  const browser = {Origin: origin, 'X-UDL-Unity':'1'};
  async function pair(instanceId = 'editor') {
    const code = await (await request('/pairing', {}, browser)).json();
    const response = await request('/pair', {...code, instanceId, name:'Unity Editor'});
    assert.equal(response.status, 200); return {...await response.json(), instanceId};
  }
  t.after(() => {routes.close();server.closeAllConnections();server.close();rmSync(directory,{recursive:true,force:true});});
  return {directory, project, routes, request, browser, pair, advance: (ms:number) => {now += ms; routes.sweep();}};
}

test('Unity native simulator pairs once, streams without history, expires and revokes', async t => {
  const f = await fixture(t);
  const pairing = await (await f.request('/pairing', {}, f.browser)).json();
  const payload = {...pairing, instanceId:'editor', name:'Editor'};
  const auth = await (await f.request('/pair', payload)).json();
  assert.equal((await f.request('/pair', payload)).status, 401);
  const batch = {version:1, projectId:auth.projectId, instanceId:'editor', name:'Editor', dropped:2, logs:[{timestamp:'2026-10-20T12:00:00.000Z', message:'hello', stackTrace:'at Test()', type:'Warning'}]};
  const headers = {Authorization:'Bearer ' + auth.token};
  assert.equal((await f.request('/batch', batch, headers)).status, 200);
  const device = f.routes.devices()[0]!; assert.equal(device.platform, 'unity'); assert.ok(device.id.includes(auth.projectId), 'source identity includes project');
  const messages: any[] = []; let ended = 0;
  const stop = await f.routes.openLogs(device, m => messages.push(m), () => ended++);
  assert.equal(messages.length, 0);
  await f.request('/batch', batch, headers);
  assert.equal(messages[0].message, 'hello\nat Test()'); assert.equal(messages[0].level, 'W');
  f.advance(15001); assert.equal(ended, 1); assert.equal(f.routes.devices().length, 0); stop();
  await f.request('/batch', {...batch, logs:[]}, headers);
  assert.equal(f.routes.devices().length, 1);
  assert.equal((await f.request('/pairing', undefined, f.browser, 'DELETE')).status, 204);
  assert.equal((await f.request('/batch', batch, headers)).status, 401);
});

test('Unity rejects browser forgery, wrong host, invalid protocol, stale pairing and oversized batches', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/pairing', {})).status, 403);
  assert.equal((await f.request('/pairing', {}, {...f.browser, Origin:'https://evil.test'})).status, 403);
  const hostStatus = await new Promise<number | undefined>(resolve => { const r = httpRequest(f.browser.Origin + '/api/unity/state', {headers:{Host:'evil.test'}}, res => {res.resume();resolve(res.statusCode);});r.end(); });
  assert.equal(hostStatus,403);
  const code = await (await f.request('/pairing', {}, f.browser)).json(); f.advance(120001);
  assert.equal((await f.request('/pair', {...code,instanceId:'e',name:'E'})).status, 401);
  const auth = await f.pair(); const h = {Authorization:'Bearer ' + auth.token};
  const b = {version:1, ...auth, name:'E', dropped:0, logs:[]};
  assert.equal((await f.request('/batch', {...b,version:2},h)).status,400);
  assert.equal((await f.request('/batch', {...b,projectId:'other'},h)).status,401);
  assert.equal((await f.request('/batch', {...b,logs:Array(201).fill({})},h)).status,400);
  assert.equal((await f.request('/batch', {...b,name:'x'.repeat(300000)},h)).status,413);
});

test('Unity project identity persists privately and config bytes remain unchanged', async t => {
  const f = await fixture(t); const config = '# untouched\nunknown: [1, 2]\n';
  writeFileSync(f.project!.configPath, config);
  const first = await (await f.request('/pairing', {},f.browser)).json();
  const other = unityRoutes(f.project, 12345); t.after(other.close);
  assert.equal(readFileSync(f.project!.configPath,'utf8'),config);
  assert.equal(statSync(join(f.project!.configDirectory,'local')).mode & 0o777,0o700);
  assert.equal(statSync(join(f.project!.configDirectory,'local','unity.json')).mode & 0o777,0o600);
  assert.match(readFileSync(join(f.project!.configDirectory,'.gitignore'),'utf8'),new RegExp('/local/'));
  assert.equal(JSON.parse(readFileSync(join(f.project!.configDirectory,'local','unity.json'),'utf8')).projectId,first.projectId);
});

test('Unity disabled without project and rejects symlinked secret directories', async t => {
  const f = await fixture(t,false); assert.equal((await (await f.request('/state')).json()).enabled,false);
  assert.equal((await f.request('/pairing',{},f.browser)).status,409);
  const p = initializeProject(f.directory)!; writeFileSync(p.configPath,'unity: {enabled: true}'); const target = join(f.directory,'outside');mkdirSync(target);
  symlinkSync(target,join(p.configDirectory,'local'));
  assert.throws(() => unityRoutes(p,12345), /symlink|directory/i);
});


test('Unity bounds sessions, subscribers, requests and pairing guesses; abort releases viewers', async t => {
  const f = await fixture(t);
  const auth = await f.pair();
  await f.request('/batch',{version:1,...auth,name:'Editor',dropped:0,logs:[]},{Authorization:'Bearer '+auth.token});
  const device=f.routes.devices()[0]!;const stops: (() => void)[]=[];let ended=0;
  const abort = new AbortController();
  stops.push(await f.routes.openLogs(device,()=>{},()=>ended++,abort.signal));
  for(let i=1;i<8;i++) stops.push(await f.routes.openLogs(device,()=>{},()=>ended++));
  await assert.rejects(f.routes.openLogs(device,()=>{},()=>{}),/limit/);
  abort.abort();stops.push(await f.routes.openLogs(device,()=>{},()=>ended++));
  for(let i=1;i<8;i++) await f.pair('editor'+i);
  const code=await (await f.request('/pairing',{},f.browser)).json();
  assert.equal((await f.request('/pair',{...code,instanceId:'overflow',name:'E'})).status,429);
  const state=await (await f.request('/state')).json();assert.equal(state.paired,true);assert.equal(JSON.stringify(state).includes(auth.token),false);
  f.routes.close();assert.equal(ended,8);stops.forEach(stop=>stop());assert.equal(ended,8);
  const g=await fixture(t);
  const pairing=await (await g.request('/pairing',{},g.browser)).json();
  for(let i=0;i<10;i++) assert.equal((await g.request('/pair',{...pairing,code:'wrong',instanceId:'e',name:'E'})).status,401);
  assert.equal((await g.request('/pair',{...pairing,instanceId:'e',name:'E'})).status,429);
  let status=200;for(let i=0;i<100;i++) status=(await g.request('/state')).status;
  assert.equal(status,429);g.advance(1001);assert.equal((await g.request('/state')).status,200);
});

test('Unity identity rejects symlinked files and preserves ignore rules verbatim', async t => {
  const f=await fixture(t,false);const p=initializeProject(f.directory)!; writeFileSync(p.configPath,'unity: {enabled: true}');
  const ignore=join(p.configDirectory,'.gitignore');writeFileSync(ignore,'# custom\n!local/\n');
  const routes=unityRoutes(p,12345);routes.close();
  assert.equal(readFileSync(ignore,'utf8'),'# custom\n!local/\n/local/\n');
  const secret=join(p.configDirectory,'local','unity.json');rmSync(secret);
  const target=join(f.directory,'target');writeFileSync(target,'unchanged');symlinkSync(target,secret);
  assert.throws(()=>unityRoutes(p,12345));assert.equal(readFileSync(target,'utf8'),'unchanged');
});


test('Unity reports installed package path and sums acknowledged batch drop deltas',async t=>{
 const f=await fixture(t);const auth=await f.pair();
 const b={version:1,...auth,name:'Editor',dropped:2,logs:[]};const h={Authorization:'Bearer '+auth.token};
 await f.request('/batch',b,h);await f.request('/batch',b,h);
 const state=await (await f.request('/state')).json();
 assert.equal(state.sources[0].dropped,4);
 assert.equal(state.packagePath,join(process.cwd(),'unity-package'));
});

test('Unity counts a record truncated at viewer boundary as lossy', async t=>{
 const f=await fixture(t); const auth=await f.pair();
 await f.request('/batch',{version:1,...auth,name:'Editor',dropped:0,logs:[{timestamp:new Date().toISOString(),message:'m'.repeat(16000),stackTrace:'s'.repeat(1000),type:'Error'}]},{Authorization:'Bearer '+auth.token});
 const state=await (await f.request('/state')).json(); assert.equal(state.sources[0].dropped,1);
});

test('project config requires explicit boolean opt-in',async t=>{
 const f=await fixture(t,false);const p=initializeProject(f.directory)!;
 for(const content of ['', '# comment\nother: [1, 2]\n', 'unity: {enabled: false}', 'unity: {enabled: "true"}']) {
 writeFileSync(p.configPath,content);const r=unityRoutes(p,12345);t.after(r.close);assert.equal(r.enabled,false);assert.equal(readFileSync(p.configPath,'utf8'),content);
 }
 writeFileSync(p.configPath,'unity: {enabled: true}');const r=unityRoutes(p,12345);t.after(r.close);assert.equal(r.enabled,true);
});
test('durable authorization survives restart and revocation',async t=>{
 const f=await fixture(t);const auth=await f.pair();f.routes.close();
 const app=express();const server=createServer(app);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const port=(server.address() as {port:number}).port;const r=unityRoutes(f.project,port);app.use('/api/unity',r.router);
 t.after(()=>{r.close();server.closeAllConnections();server.close();});
 const origin='http://127.0.0.1:'+port;
 const batch=()=>fetch(origin+'/api/unity/batch',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth.token},body:JSON.stringify({version:1,...auth,name:'Editor',dropped:0,logs:[]})});
 assert.equal((await batch()).status,200);
 await fetch(origin+'/api/unity/pairing',{method:'DELETE',headers:{Origin:origin,'X-UDL-Unity':'1'}});
 assert.equal((await batch()).status,401);
 const saved=readFileSync(join(f.project!.configDirectory,'local','unity.json'),'utf8');assert.ok(!saved.includes(auth.token));assert.deepEqual(JSON.parse(saved).sessions,{});
});

test('revocation from another live server is respected and corrupt grants fail closed',async t=>{
 const f=await fixture(t);const auth=await f.pair();
 const path=join(f.project!.configDirectory,'local','unity.json');
 const saved=JSON.parse(readFileSync(path,'utf8'));saved.sessions={};writeFileSync(path,JSON.stringify(saved));
 const batch={version:1,...auth,name:'Editor',dropped:0,logs:[]};const h={Authorization:'Bearer '+auth.token};
 assert.equal((await f.request('/batch',batch,h)).status,401);
 writeFileSync(path,'broken');assert.notEqual((await f.request('/batch',batch,h)).status,200);
});
test('malformed YAML fails closed without rewriting it or creating secrets',async t=>{
 const f=await fixture(t,false);const p=initializeProject(f.directory)!;const content='unity: [invalid';writeFileSync(p.configPath,content);
 assert.throws(()=>unityRoutes(p,12345),/YAML/);assert.equal(readFileSync(p.configPath,'utf8'),content);
});

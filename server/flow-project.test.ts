import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, readFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { FlowProject } from './flow-project.js';
const source = `version: 1\nid: test\nname: Test\nstart: start\ntimeout: 5s\ncorrelation: {scope: device-session, primary: id}\nsteps:\n - id: start\n   name: Start\n   match: {contains: test}\n   extract: {id: {json: id, required: true}}\n   outcome: completed\n`;
async function fixture() {
 const root = await mkdtemp(join(tmpdir(), 'flow-test-'));
 await mkdir(join(root,'.udl'));
 await writeFile(join(root,'.udl','config.yaml'), '');
 return {root, async cleanup() {await rm(root, {recursive:true,force:true});}};
}
test('config discovery defaults and creates missing directory only on valid save', async () => {
 const f = await fixture(); try {
 const project = await FlowProject.create(f.root);
 assert.ok((await project.reload()).diagnostics.length);
 const saved = await project.save('test.yaml',source,undefined,true);
 assert.equal('blueprints' in saved && saved.blueprints.length,1);
 assert.equal(await readFile(join(f.root,'.udl','flows','test.yaml'),'utf8'),source);
 await assert.rejects(project.save('../escape.yaml',source,undefined,true));
 await assert.rejects(project.save('test.yaml',source,undefined,true), /already exists|changed/);
 } finally {await f.cleanup();}
});
test('invalid reload keeps complete last-good definitions and revision', async () => {
 const f = await fixture(); try {
 const project = await FlowProject.create(f.root);
 await project.save('test.yaml',source,undefined,true);
 const before = await project.reload();
 await writeFile(join(f.root,'.udl','flows','test.yaml'),'invalid: true');
 const after = await project.reload();
 assert.equal(after.revision,before.revision); assert.deepEqual(after.blueprints,before.blueprints); assert.ok(after.diagnostics.length);
 } finally {await f.cleanup();}
});
test('external edit conflicts, invalid candidate sets and symlinks are rejected', async () => {
 const f = await fixture(); try {
 const project = await FlowProject.create(f.root);
 await project.save('test.yaml',source,undefined,true);
 const previous = await project.reload();
 await writeFile(join(f.root,'.udl','flows','test.yaml'),source+'# external');
 await assert.rejects(project.save('test.yaml',source,previous.files[0]!.revision), /changed/);
 const duplicate = await project.save('duplicate.yml',source,undefined,true);
 assert.ok(duplicate.diagnostics.length);
 await symlink(join(f.root,'.udl','flows','test.yaml'), join(f.root,'.udl','flows','linked.yaml'));
 assert.ok((await project.reload()).diagnostics.some(d => d.file === 'linked.yaml'));
 } finally {await f.cleanup();}
});
test('config rejects escaping roots, aliases and directory symlinks', async () => {
 const f = await fixture(); try {
 for (const config of ['blueprints: ..', 'blueprints: &a .flows\nother: *a']) {
 await writeFile(join(f.root,'.udl','config.yaml'),config); await assert.rejects(FlowProject.create(f.root));
 }
 await writeFile(join(f.root,'.udl','config.yaml'),'blueprints: linked');
 await mkdir(join(f.root,'target')); await symlink(join(f.root,'target'),join(f.root,'linked'));
 await assert.rejects(FlowProject.create(f.root),/symlink/);
 } finally {await f.cleanup();}
});
test('API requires token and JSON for mutations and validates without writing', async () => {
 const f = await fixture(); const app = express(); const project = await FlowProject.create(f.root); app.use('/api/flows',project.router());
 const server = app.listen(0,'127.0.0.1'); await new Promise<void>(r => server.once('listening',r));
 const address = server.address() as {port:number}; const url = `http://127.0.0.1:${address.port}/api/flows`;
 try {
 const snapshot = await (await fetch(`${url}/snapshot`)).json() as {token:string};
 assert.equal((await fetch(`${url}/reload`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,403);
 const headers = {'content-type':'application/json','x-flow-token':snapshot.token};
 const validated = await fetch(`${url}/validate`,{method:'POST',headers,body:JSON.stringify({source,filename:'test.yaml'})});
 assert.equal(validated.status,200); assert.deepEqual(await validated.json(),{diagnostics:[]});
 const created = await fetch(`${url}/blueprints`,{method:'POST',headers,body:JSON.stringify({source,filename:'test.yaml'})});
 assert.equal(created.status,200);
 const invalid = await fetch(`${url}/blueprints`,{method:'POST',headers,body:JSON.stringify({source:'oops: true',filename:'broken.yaml'})}); assert.equal(invalid.status,422);
 const update = await fetch(`${url}/blueprints/test.yaml`,{method:'PUT',headers,body:JSON.stringify({source,revision:'old'})}); assert.equal(update.status,409);
 } finally {server.closeAllConnections();server.close(); await f.cleanup();}
});
test('config rejects oversized and non-regular files before reading', async () => {
 const f = await fixture(); try {
 await writeFile(join(f.root,'.udl','config.yaml'),'#'.repeat(256*1024+1));
 await assert.rejects(FlowProject.create(f.root), /256 KiB/);
 await rm(join(f.root,'.udl','config.yaml')); await mkdir(join(f.root,'.udl','config.yaml'));
 await assert.rejects(FlowProject.create(f.root), /regular file/);
 } finally {await f.cleanup();}
});
test('blocked draft files never prevent valid blueprints from activating', async () => {
 const f = await fixture(); try {
 await mkdir(join(f.root,'.udl','flows'));
 await writeFile(join(f.root,'.udl','flows','purchase.yaml'),source);
 await writeFile(join(f.root,'.udl','flows','assets.draft.yaml'),'version: 1\nid: blocked\n');
 await writeFile(join(f.root,'.udl','flows','other.draft.yml'),'broken: [');
 const project=await FlowProject.create(f.root);
 const snapshot=await project.reload();
 assert.deepEqual(snapshot.diagnostics,[]);
 assert.deepEqual(snapshot.files.map(file=>file.filename),['purchase.yaml']);
 assert.deepEqual(snapshot.blueprints.map(blueprint=>blueprint.id),['test']);
 await assert.rejects(project.save('new.draft.yaml',source,undefined,true),/draft/i);
 assert.deepEqual((await project.reload()).blueprints.map(blueprint=>blueprint.id),['test']);
 } finally {await f.cleanup();}
});

test('project setup creates missing shared config and uses .udl/flows', async () => {
 const f=await fixture(); try {
 await rm(join(f.root,'.udl'),{recursive:true});
 const project=await FlowProject.create(f.root);
 assert.equal(await readFile(join(f.root,'.udl','config.yaml'),'utf8'),'');
 assert.equal((await project.reload()).directory,join('.udl','flows'));
 await project.save('test.yaml',source,undefined,true);
 assert.equal(await readFile(join(f.root,'.udl','flows','test.yaml'),'utf8'),source);
 } finally {await f.cleanup();}
});
test('flow settings coexist with future project settings and custom paths', async () => {
 const f=await fixture(); try {
 const config='blueprints: custom-flows\nfutureSetting: true\n';
 await writeFile(join(f.root,'.udl','config.yaml'),config);
 const project=await FlowProject.create(f.root);
 await project.save('test.yaml',source,undefined,true);
 assert.equal(await readFile(join(f.root,'custom-flows','test.yaml'),'utf8'),source);
 assert.equal(await readFile(join(f.root,'.udl','config.yaml'),'utf8'),config);
 } finally {await f.cleanup();}
});


test('legacy default config and blueprints migrate automatically and repeat safely', async () => {
 const f=await fixture(); try {
 await rm(join(f.root,'.udl'),{recursive:true});
 await writeFile(join(f.root,'.flowsrc'),'# legacy comment\nblueprints: .flows\n');
 await mkdir(join(f.root,'.flows'));
 await writeFile(join(f.root,'.flows','test.yaml'),source);
 const project=await FlowProject.create(f.root);
 assert.equal((await project.reload()).blueprints.length,1);
 assert.match(await readFile(join(f.root,'.udl','config.yaml'),'utf8'),/blueprints: .udl\/flows/);
 assert.match(await readFile(join(f.root,'.udl','config.yaml'),'utf8'),/# legacy comment/);
 assert.equal(await readFile(join(f.root,'.udl','flows','test.yaml'),'utf8'),source);
 await assert.rejects(readFile(join(f.root,'.flows','test.yaml')), {code:'ENOENT'});
 assert.equal((await (await FlowProject.create(f.root)).reload()).blueprints.length,1);
 } finally {await f.cleanup();}
});
test('legacy custom flow paths are preserved while migrating an empty shared config', async () => {
 const f=await fixture(); try {
 await writeFile(join(f.root,'.flowsrc'),'blueprints: custom-flows\n');
 await mkdir(join(f.root,'custom-flows'));
 await writeFile(join(f.root,'custom-flows','test.yaml'),source);
 const project=await FlowProject.create(f.root);
 assert.equal((await project.reload()).directory,'custom-flows');
 assert.equal((await project.reload()).blueprints.length,1);
 } finally {await f.cleanup();}
});
test('migration refuses conflicting legacy and destination directories without altering files', async () => {
 const f=await fixture(); try {
 await writeFile(join(f.root,'.flowsrc'),'');
 await mkdir(join(f.root,'.flows'));
 await writeFile(join(f.root,'.flows','old.yaml'),source);
 await mkdir(join(f.root,'.udl','flows'));
 await writeFile(join(f.root,'.udl','flows','new.yaml'),'preserve');
 await assert.rejects(FlowProject.create(f.root),/both|conflict/i);
 assert.equal(await readFile(join(f.root,'.flows','old.yaml'),'utf8'),source);
 assert.equal(await readFile(join(f.root,'.udl','flows','new.yaml'),'utf8'),'preserve');
 assert.equal(await readFile(join(f.root,'.udl','config.yaml'),'utf8'),'');
 } finally {await f.cleanup();}
});
test('existing nonempty shared configuration takes precedence over legacy configuration', async () => {
 const f=await fixture(); try {
 const config='futureSetting: true\nblueprints: custom-flows\n';
 await writeFile(join(f.root,'.udl','config.yaml'),config);
 await writeFile(join(f.root,'.flowsrc'),'invalid: [');
 const project=await FlowProject.create(f.root);
 assert.equal((await project.reload()).directory,'custom-flows');
 assert.equal(await readFile(join(f.root,'.udl','config.yaml'),'utf8'),config);
 } finally {await f.cleanup();}
});
test('legacy .flows migrates with no legacy config and rejects directory symlinks', async () => {
 const f=await fixture(); try {
 await mkdir(join(f.root,'.flows'));
 await writeFile(join(f.root,'.flows','test.yaml'),source);
 assert.equal((await (await FlowProject.create(f.root)).reload()).blueprints.length,1);
 } finally {await f.cleanup();}
 const g=await fixture(); try {
 await mkdir(join(g.root,'target'));
 await symlink(join(g.root,'target'),join(g.root,'.flows'));
 await assert.rejects(FlowProject.create(g.root),/symlink/);
 } finally {await g.cleanup();}
});

test('symlinked .udl cannot move legacy flows outside the project', async () => {
 const f=await fixture(); const outside=await fixture(); try {
 await rm(join(f.root,'.udl'),{recursive:true});
 await symlink(outside.root,join(f.root,'.udl'),'junction');
 await mkdir(join(f.root,'.flows'));
 await writeFile(join(f.root,'.flows','test.yaml'),source);
 await assert.rejects(FlowProject.create(f.root),/not a symlink/);
 assert.equal(await readFile(join(f.root,'.flows','test.yaml'),'utf8'),source);
 await assert.rejects(readFile(join(outside.root,'config.yaml')),{code:'ENOENT'});
 await assert.rejects(readFile(join(outside.root,'flows','test.yaml')),{code:'ENOENT'});
 } finally {await f.cleanup();await outside.cleanup();}
});

test('legacy YAML null configuration migrates like an empty mapping', async () => {
 for (const config of ['null\n','~\n']) {
 const f=await fixture(); try {
 await writeFile(join(f.root,'.flowsrc'),config);
 await mkdir(join(f.root,'.flows'));
 await writeFile(join(f.root,'.flows','test.yaml'),source);
 assert.equal((await (await FlowProject.create(f.root)).reload()).blueprints.length,1);
 assert.equal((await (await FlowProject.create(f.root)).reload()).blueprints.length,1);
 } finally {await f.cleanup();}
 }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FlowProject } from './flow-project.js';
import { createFlowEngine } from '../shared/flow-engine.js';
import { bundleZip, fixtureBundle, fixtureBlueprint } from './fixtures/flow-bundle.js';
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'udl-catalog-')); const home = join(root, 'home'), project = join(root, 'project'), other = join(root, 'other');
  for (const path of [home, project, other]) await mkdir(path);
  return { root, home, project, other, close: () => rm(root, { recursive: true, force: true }) };
}
async function bundle(root: string, id = 'sample', blueprintId = 'fixture') { await mkdir(join(root, '.udl/bundles'), { recursive: true }); await writeFile(join(root, '.udl/bundles', `${id}.blueprint`), fixtureBundle(id, blueprintId)); }
async function loose(root: string, id: string) { await mkdir(join(root, '.udl/flows'), { recursive: true }); await writeFile(join(root, '.udl/flows', `${id}.yaml`), fixtureBlueprint(id)); }
const fetchBundle = async () => new Response(new Uint8Array(fixtureBundle()), { status: 200 });
test('global sources load without a project and global/project activation selections remain independent', async () => {
  const f = await fixture(); try {
    await loose(f.home, 'global'); await loose(f.project, 'local'); await bundle(f.home);
    const global = await FlowProject.create(undefined, { home: f.home }); const local = await FlowProject.create(f.project, { home: f.home });
    assert.deepEqual((await global.reload()).blueprints.map(b => b.id), ['global']);
    let snapshot = await local.reload(); assert.deepEqual(snapshot.blueprints.map(b => b.id).sort(), ['global', 'local']);
    assert.equal(snapshot.context, 'project'); assert.equal(snapshot.sources!.find(s => s.kind === 'bundle')!.enabled, false);
    await local.setBundleEnabled('global:bundle:sample', true, snapshot.configRevision);
    assert.ok((await local.reload()).blueprints.some(b => b.id === 'fixture'));
    assert.ok(!(await global.reload()).blueprints.some(b => b.id === 'fixture'));
    const other = await FlowProject.create(f.other, { home: f.home }); assert.ok(!(await other.reload()).blueprints.some(b => b.id === 'fixture'));
    snapshot = await global.reload(); await global.setBundleEnabled('global:bundle:sample', true, snapshot.configRevision);
    assert.ok((await global.reload()).blueprints.some(b => b.id === 'fixture'));
    assert.ok(!(await other.reload()).blueprints.some(b => b.id === 'fixture'));
  } finally { await f.close(); }
});
test('duplicate active IDs deactivate all colliding definitions but unrelated flows remain active', async () => {
  const f = await fixture(); try {
    await loose(f.home, 'same'); await loose(f.project, 'same'); await loose(f.project, 'other');
    const catalog = await FlowProject.create(f.project, { home: f.home }); const snapshot = await catalog.reload();
    assert.deepEqual(snapshot.blueprints.map(b => b.id), ['other']); assert.deepEqual(snapshot.conflictedBlueprintIds, ['same']);
    assert.ok(snapshot.diagnostics.some(d => /global.*project|project.*global/.test(d.message)));
  } finally { await f.close(); }
});
test('disabling a bundle retires pinned instances and re-enabling does not replay pending records', async () => {
  const f = await fixture(); try {
    await bundle(f.home); const catalog = await FlowProject.create(f.project, { home: f.home }); let snapshot = await catalog.reload();
    snapshot = await catalog.setBundleEnabled('global:bundle:sample', true, snapshot.configRevision);
    const engine = createFlowEngine(() => 0); engine.setBlueprints(snapshot.blueprints, snapshot.revision, snapshot);
    const log = (event: string) => ({ timestamp: 'now', message: JSON.stringify({ event, id: 'one' }) });
    engine.ingest([log('fixture.start')]);
    snapshot = await catalog.setBundleEnabled('global:bundle:sample', false, snapshot.configRevision); engine.setBlueprints(snapshot.blueprints, snapshot.revision, snapshot);
    engine.ingest([log('fixture.done')]); assert.equal(engine.getState().instances[0]!.outcome, 'interrupted'); assert.equal(engine.getState().instances[0]!.observations.length, 1);
    snapshot = await catalog.setBundleEnabled('global:bundle:sample', true, snapshot.configRevision); engine.setBlueprints(snapshot.blueprints, snapshot.revision, snapshot); engine.ingest([log('fixture.start')]);
    assert.equal(engine.getState().instances[1]!.observations.length, 1);
  } finally { await f.close(); }
});
test('URL install is exclusive, initially disabled and atomic on validation/download failures', async () => {
  const f = await fixture(); try {
    const catalog = await FlowProject.create(f.project, { home: f.home, fetch: fetchBundle });
    const snapshot = await catalog.installBundle('https://example.test/sample.blueprint', 'global');
    assert.ok(snapshot.sources!.some(s => s.id === 'global:bundle:sample' && !s.enabled));
    assert.deepEqual(await readFile(join(f.home, '.udl/bundles/sample.blueprint')), fixtureBundle());
    await assert.rejects(catalog.installBundle('https://example.test/sample.blueprint', 'global'), /exists|installed/);
    const bad = await FlowProject.create(f.project, { home: f.home, fetch: async () => new Response('not a zip') });
    await assert.rejects(bad.installBundle('https://example.test/bad.blueprint', 'project'));
    assert.deepEqual(await readdir(join(f.home, '.udl/bundles')), ['sample.blueprint']);
    const global = await FlowProject.create(undefined, { home: f.home, fetch: fetchBundle });
    await assert.rejects(global.installBundle('https://example.test/a.blueprint', 'project'), /project/i);
  } finally { await f.close(); }
});
test('activation preserves config comments and unrelated settings and detects stale writes', async () => {
  const f = await fixture(); try {
    await bundle(f.home); await mkdir(join(f.project, '.udl')); const content = '# Keep this\nfutureSetting: true\n'; await writeFile(join(f.project, '.udl/config.yaml'), content);
    const catalog = await FlowProject.create(f.project, { home: f.home }); const before = await catalog.reload();
    await catalog.setBundleEnabled('global:bundle:sample', true, before.configRevision);
    assert.match(await readFile(join(f.project, '.udl/config.yaml'), 'utf8'), /# Keep this\nfutureSetting: true/);
    await assert.rejects(catalog.setBundleEnabled('global:bundle:sample', false, before.configRevision), /changed|reload/i);
  } finally { await f.close(); }
});
test('global configuration and managed bundle paths reject symlinks', async () => {
  const f = await fixture(); try {
    await mkdir(join(f.home, '.udl')); await symlink(f.project, join(f.home, '.udl/bundles'));
    const catalog = await FlowProject.create(f.other, { home: f.home, fetch: fetchBundle });
    assert.ok((await catalog.reload()).diagnostics.some(d => /symlink/.test(d.message)));
    await assert.rejects(catalog.installBundle('https://example.test/sample.blueprint', 'global'), /symlink/);
    assert.deepEqual(await readdir(f.project), []);
  } finally { await f.close(); }
});

test('a retired disabled source cannot stop a same-ID instance from another active source', async () => {
  const engine = createFlowEngine(() => 0); const base = JSON.parse(fixtureBlueprint());
  const first = { ...base, sourceId: 'global:bundle:old' }, second = { ...base, sourceId: 'project:loose' };
  const log = (event: string,id: string) => ({ timestamp:'now',message:JSON.stringify({event,id}) });
  engine.setBlueprints([first],'old'); engine.ingest([log('fixture.start','a')]);
  engine.setBlueprints([second],'new',{inactiveSources:['global:bundle:old']}); engine.ingest([log('fixture.start','b')]);
  engine.setBlueprints([second],'next',{inactiveSources:['global:bundle:old']}); engine.ingest([log('fixture.done','b')]);
  assert.equal(engine.getState().instances[1]!.outcome,'completed');
});
test('simultaneous installers publish exactly one archive and leave no temporary files', async () => {
  const f=await fixture(); try {
    const a=await FlowProject.create(f.project,{home:f.home,fetch:fetchBundle}), b=await FlowProject.create(f.project,{home:f.home,fetch:fetchBundle});
    const results=await Promise.allSettled([a.installBundle('https://example.test/a.blueprint','global'),b.installBundle('https://example.test/a.blueprint','global')]);
    assert.equal(results.filter(result=>result.status==='fulfilled').length,1); assert.deepEqual(await readdir(join(f.home,'.udl/bundles')),['sample.blueprint']);
  } finally {await f.close();}
});

test('conflicts inside one loose directory identify both files without suppressing unrelated flows', async () => {
  const f=await fixture(); try {
    await loose(f.project,'same');await loose(f.project,'other');await writeFile(join(f.project,'.udl/flows/duplicate.yaml'),fixtureBlueprint('same'));
    const catalog=await FlowProject.create(f.project,{home:f.home});const snapshot=await catalog.reload();
    assert.deepEqual(snapshot.blueprints.map(b=>b.id),['other']);
    assert.ok(snapshot.diagnostics.some(d=>/same.yaml/.test(d.message)&&/duplicate.yaml/.test(d.message)));
  } finally {await f.close();}
});

test('new and reinstalled bundles stay disabled in every previously selected project', async () => {
  const f=await fixture(); try {
    await mkdir(join(f.home,'.udl'));await writeFile(join(f.home,'.udl/config.yaml'),'bundles:\n  global:\n    sample: true\n');
    const global=await FlowProject.create(undefined,{home:f.home,fetch:fetchBundle});let snapshot=await global.installBundle('https://example.test/a.blueprint','global');
    assert.equal(snapshot.sources!.find(s=>s.kind==='bundle')!.enabled,false);
    const a=await FlowProject.create(f.project,{home:f.home,fetch:fetchBundle}), b=await FlowProject.create(f.other,{home:f.home});
    let x=await a.reload(); await a.setBundleEnabled('global:bundle:sample',true,x.configRevision);x=await b.reload();await b.setBundleEnabled('global:bundle:sample',true,x.configRevision);
    await rm(join(f.home,'.udl/bundles/sample.blueprint'));
    await a.installBundle('https://example.test/a.blueprint','global');
    for(const catalog of [global,a,b]) assert.equal((await catalog.reload()).sources!.find(s=>s.kind==='bundle')!.enabled,false);
  } finally {await f.close();}
});
test('source removal remains observable after intermediate snapshot consumers', async () => {
  const f=await fixture();try{
    await bundle(f.home);const catalog=await FlowProject.create(f.project,{home:f.home});let snapshot=await catalog.reload();snapshot=await catalog.setBundleEnabled('global:bundle:sample',true,snapshot.configRevision);
    const engine=createFlowEngine(()=>0);engine.setBlueprints(snapshot.blueprints,snapshot.revision,snapshot);engine.ingest([{timestamp:'now',message:'{"event":"fixture.start","id":"one"}'}]);
    await rm(join(f.home,'.udl/bundles/sample.blueprint'));await catalog.reload();snapshot=await catalog.reload();engine.setBlueprints(snapshot.blueprints,snapshot.revision,snapshot);
    engine.ingest([{timestamp:'now',message:'{"event":"fixture.done","id":"one"}'}]);assert.equal(engine.getState().instances[0]!.outcome,'interrupted');
  }finally{await f.close();}
});
test('installation rejects a 33rd bundle before changing existing sources', async () => {
  const f=await fixture();try{
    for(let i=0;i<32;i++)await bundle(f.home,`b${i}`,`flow${i}`);
    const catalog=await FlowProject.create(f.project,{home:f.home,fetch:fetchBundle});let snapshot=await catalog.reload();
    for(let i=0;i<32;i++)snapshot=await catalog.setBundleEnabled(`global:bundle:b${i}`,true,snapshot.configRevision);
    assert.equal(snapshot.blueprints.length,32);
    await assert.rejects(catalog.installBundle('https://example.test/a.blueprint','global'),/32|limit/);
    assert.equal((await readdir(join(f.home,'.udl/bundles'))).length,32);assert.equal((await catalog.reload()).blueprints.length,32);
  }finally{await f.close();}
});

test('a client that misses disable/re-enable still retires its prior recognition generation', async () => {
  const f=await fixture();try{
    await bundle(f.home);const catalog=await FlowProject.create(f.project,{home:f.home});let snapshot=await catalog.reload();snapshot=await catalog.setBundleEnabled('global:bundle:sample',true,snapshot.configRevision);
    const engine=createFlowEngine(()=>0);engine.setBlueprints(snapshot.blueprints,snapshot.revision,snapshot);engine.ingest([{timestamp:'now',message:'{"event":"fixture.start","id":"one"}'}]);
    snapshot=await catalog.setBundleEnabled('global:bundle:sample',false,snapshot.configRevision);snapshot=await catalog.setBundleEnabled('global:bundle:sample',true,snapshot.configRevision);
    engine.setBlueprints(snapshot.blueprints,snapshot.revision,snapshot);engine.ingest([{timestamp:'now',message:'{"event":"fixture.done","id":"one"}'}]);assert.equal(engine.getState().instances[0]!.outcome,'interrupted');
  }finally{await f.close();}
});


test('expanded scope inventory is checked before publishing an additional bundle', async () => {
  const f=await fixture();try{
    const make=(id:string)=>bundleZip([{name:'config.yaml',source:`id: ${id}\nname: Large example\ndescription: Resource limit fixture\nspecVersion: 1\n`},...Array.from({length:8},(_,i)=>({name:`f${i}.yaml`,source:fixtureBlueprint(`${id}-${i}`)+'\n#'+'x'.repeat(200*1024)}))]);
    await mkdir(join(f.home,'.udl/bundles'),{recursive:true});
    for(let i=0;i<10;i++)await writeFile(join(f.home,'.udl/bundles',`b${i}.blueprint`),make(`b${i}`));
    const catalog=await FlowProject.create(f.project,{home:f.home,fetch:async()=>new Response(new Uint8Array(make('extra')))});
    await assert.rejects(catalog.installBundle('https://example.test/extra.blueprint','global'),/16 MiB|inventory/);
    assert.equal((await readdir(join(f.home,'.udl/bundles'))).length,10);assert.equal((await catalog.reload()).sources!.filter(s=>s.kind==='bundle').length,10);
  }finally{await f.close();}
});

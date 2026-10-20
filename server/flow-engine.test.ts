import test from 'node:test';
import assert from 'node:assert/strict';
import { createFlowEngine } from '../shared/flow-engine.js';
import type { FlowBlueprint } from '../shared/flow-types.js';
import type { LogMessage } from '../shared/types.js';
const blueprint: FlowBlueprint = { version: 1, id: 'purchase', name: 'Purchase', start:'init', timeout:'5s', correlation:{scope:'device-session',primary:'attempt',aliases:['uid']}, steps:[
 {id:'init',name:'Init',match:{json:{path:'event',equals:'init'}},extract:{attempt:{json:'attempt',required:true}},next:['ready']},
 {id:'ready',name:'Ready',match:{json:{path:'event',equals:'ready'}},extract:{attempt:{json:'attempt',required:true},uid:{json:'uid',required:true}},next:['ios','android']},
 {id:'ios',name:'iOS',match:{json:{path:'event',equals:'ios'}},extract:{uid:{json:'uid',required:true}},next:['receipt']},
 {id:'android',name:'Android',match:{json:{path:'event',equals:'android'}},extract:{uid:{json:'uid',required:true}},next:['receipt']},
 {id:'receipt',name:'Receipt',match:{json:{path:'event',equals:'receipt'}},extract:{uid:{json:'uid',required:true},tx:{json:'payload.tx',required:true}},next:['submit']},
 {id:'submit',name:'Submit',match:{all:[{json:{path:'event',equals:'submit'}},{json:{path:'transaction_id',equalsFrom:{step:'receipt',field:'tx'}}}]},outcome:'completed'},
],errors:[{id:'error',appliesTo:'active',match:{json:{path:'event',equals:'error'}},extract:{uid:{json:'uid',required:true},code:{json:'code',required:true}},codeField:'code',codes:{CANCEL:{description:'User cancelled.',outcome:'cancelled'}},unknownOutcome:'failed'}]};
function log(event:string, fields:object={},deviceId='phone'):LogMessage{return {timestamp:'2026-10-18T10:00:00Z',message:JSON.stringify({event,...fields}),source:{key:deviceId,name:'Device',deviceId,platform:'ios'}};}
function setup(){let now=0;const engine=createFlowEngine(()=>now);engine.setBlueprints([blueprint],'v1');return {engine,advance:(ms:number)=>{now+=ms;engine.tick();}};}
function untilReceipt(engine:ReturnType<typeof createFlowEngine>,a='a',uid='u',tx='t'){engine.ingest([log('init',{attempt:a}),log('ready',{attempt:a,uid}),log('ios',{uid}),log('receipt',{uid,payload:{tx}})]);}
test('flow engine isolates concurrent purchases and matches downstream payload-only IDs',()=>{const {engine}=setup();untilReceipt(engine,'a','u1','t1');untilReceipt(engine,'b','u2','t2');engine.ingest([log('submit',{transaction_id:'t2'})]);const rows=engine.getState().instances;assert.equal(rows.length,2);assert.equal(rows.find(x=>x.bindings.attempt==='a')?.outcome,'running');const done=rows.find(x=>x.bindings.attempt==='b')!;assert.equal(done.outcome,'completed');assert.equal(done.observations.at(-1)?.stepId,'submit');});
test('flow engine requires exact typed values and keeps missing refs from matching',()=>{const {engine}=setup();untilReceipt(engine);engine.ingest([log('submit',{}),log('submit',{transaction_id:0}),log('submit',{transaction_id:'no'})]);assert.equal(engine.getState().instances[0]?.outcome,'running');engine.ingest([log('submit',{transaction_id:'t'})]);assert.equal(engine.getState().instances[0]?.outcome,'completed');});
test('branch choice excludes the other route and allows success only after predecessors',()=>{const {engine}=setup();engine.ingest([log('init',{attempt:'a'}),log('ready',{attempt:'a',uid:'u'}),log('android',{uid:'u'}),log('receipt',{uid:'u',payload:{tx:'t'}}),log('submit',{transaction_id:'t'})]);assert.equal(engine.getState().instances[0]?.outcome,'completed');assert.deepEqual(engine.getState().instances[0]?.observations.map(o=>o.stepId),['init','ready','android','receipt','submit']);});
test('buffered out of order steps are reevaluated without publishing rejected payloads',()=>{const {engine}=setup();engine.ingest([log('init',{attempt:'a'}),log('ready',{attempt:'a',uid:'u'}),log('receipt',{uid:'u',payload:{tx:'t'}}),log('submit',{transaction_id:'t'})]);assert.equal(engine.getState().instances[0]?.outcome,'running');assert.equal(engine.getState().instances[0]?.observations.length,2);engine.ingest([log('ios',{uid:'u'})]);assert.equal(engine.getState().instances[0]?.outcome,'completed');});
test('timeouts preserve outcome and show late terminal evidence',()=>{const {engine,advance}=setup();untilReceipt(engine);advance(5001);assert.equal(engine.getState().instances[0]?.outcome,'timed_out');engine.ingest([log('submit',{transaction_id:'t'})]);const row=engine.getState().instances[0]!;assert.equal(row.outcome,'timed_out');assert.equal(row.lateOutcome,'completed');});
test('known cancellation and unknown failure preserve codes',()=>{const {engine}=setup();untilReceipt(engine);engine.ingest([log('error',{uid:'u',code:'CANCEL'})]);assert.equal(engine.getState().instances[0]?.outcome,'cancelled');untilReceipt(engine,'b','v','tt');engine.ingest([log('error',{uid:'v',code:'NEW_CODE'})]);assert.equal(engine.getState().instances.find(x=>x.bindings.uid==='v')?.errorCode,'NEW_CODE');assert.equal(engine.getState().instances.find(x=>x.bindings.uid==='v')?.outcome,'failed');});
test('device boundaries prevent matching a different phone',()=>{const {engine}=setup();untilReceipt(engine);engine.ingest([log('submit',{transaction_id:'t'},'other')]);assert.equal(engine.getState().instances[0]?.outcome,'running');});
test('ambiguous payload references never pick one purchase',()=>{const {engine}=setup();untilReceipt(engine,'a','u','same');untilReceipt(engine,'b','v','same');engine.ingest([log('submit',{transaction_id:'same'})]);assert.ok(engine.getState().instances.every(x=>x.outcome==='running'&&x.completeness==='ambiguous'));});
test('capture gap, interrupt and clear keep correct boundaries',()=>{const {engine}=setup();untilReceipt(engine);engine.gap();assert.equal(engine.getState().instances[0]?.completeness,'capture_gap');engine.interrupt();assert.equal(engine.getState().instances[0]?.outcome,'interrupted');engine.clear();assert.equal(engine.getState().instances.length,0);});
test('active instances pin old blueprint revision after edits',()=>{const {engine}=setup();untilReceipt(engine);engine.setBlueprints([{...blueprint,id:'changed'}],'v2');engine.ingest([log('submit',{transaction_id:'t'})]);assert.equal(engine.getState().instances[0]?.revision,'v1');assert.equal(engine.getState().instances[0]?.outcome,'completed');});
test('a correlated non-start becomes a missing-start instance after reorder window',()=>{const {engine,advance}=setup();engine.ingest([log('receipt',{uid:'u',payload:{tx:'t'}})]);advance(2001);assert.equal(engine.getState().instances[0]?.completeness,'missing_start');assert.equal(engine.getState().instances[0]?.observations[0]?.stepId,'receipt');});
test('valid hour deadlines do not crash recognition',()=>{const {engine}=setup();engine.setBlueprints([{...blueprint,timeout:'1h'}],'v2');untilReceipt(engine);assert.equal(engine.getState().instances[0]?.timeoutAt,3600000);});
test('unrelated high-volume logs do not produce a capture gap',()=>{const {engine}=setup();untilReceipt(engine);engine.ingest(Array.from({length:1200},()=>log('unrelated')));assert.equal(engine.getState().gaps,0);assert.equal(engine.getState().instances[0]?.completeness,'complete');});
test('a late out-of-order record is retained without seeding downstream references',()=>{const {engine,advance}=setup();engine.ingest([log('init',{attempt:'a'}),log('ready',{attempt:'a',uid:'u'}),log('receipt',{uid:'u',payload:{tx:'t'}})]);advance(2001);const instance=engine.getState().instances[0]!;assert.equal(instance.completeness,'missing_steps');assert.equal(instance.observations.at(-1)?.stepId,'receipt');assert.equal(instance.observations.at(-1)?.accepted,false);engine.ingest([log('submit',{transaction_id:'t'})]);assert.equal(engine.getState().instances[0]?.outcome,'running');});
test('identifier ambiguity across pinned revisions cannot complete both flows',()=>{const {engine}=setup();untilReceipt(engine);engine.setBlueprints([blueprint],'v2');untilReceipt(engine);engine.ingest([log('submit',{transaction_id:'t'})]);assert.ok(engine.getState().instances.every(i=>i.outcome==='running'&&i.completeness==='ambiguous'));});
test('an alias collision is rejected before binding or publishing extraction',()=>{const {engine}=setup();untilReceipt(engine);engine.ingest([log('init',{attempt:'b'}),log('ready',{attempt:'b',uid:'u'})]);const rows=engine.getState().instances;assert.ok(rows.every(i=>i.completeness==='ambiguous'));assert.equal(rows.find(i=>i.bindings.attempt==='b')?.bindings.uid,undefined);});

function overlapBlueprints(): [FlowBlueprint, FlowBlueprint] {
 const match=(event:string)=>({json:{path:'event',equals:event}});
 const extract={id:{json:'id',required:true}};
 const base={version:1 as const,name:'Purchase',timeout:'5s',correlation:{scope:'device-session' as const,primary:'id'}};
 return [{...base,id:'long',start:'init',steps:[{id:'init',name:'Init',match:match('init'),extract,next:['ready']},{id:'ready',name:'Ready',match:match('ready'),extract,next:['done']},{id:'done',name:'Done',match:match('done'),extract,outcome:'completed'}]},
 {...base,id:'short',start:'init',steps:[{id:'init',name:'Init',match:match('init'),extract,next:['done']},{id:'done',name:'Done',match:match('done'),extract,outcome:'completed'}]}];
}
test('overlapping blueprints independently retain an early completion consumed by the shorter flow',()=>{
 const engine=createFlowEngine(()=>0);engine.setBlueprints(overlapBlueprints(),'v1');
 engine.ingest([log('init',{id:'purchase-1'}),log('done',{id:'purchase-1'}),log('ready',{id:'purchase-1'})]);
 const rows=engine.getState().instances;
 assert.equal(rows.length,2);assert.ok(rows.every(row=>row.outcome==='completed'));
 assert.deepEqual(rows.find(row=>row.blueprint.id==='long')?.observations.map(row=>row.stepId),['init','ready','done']);
 assert.deepEqual(rows.find(row=>row.blueprint.id==='short')?.observations.map(row=>row.stepId),['init','done']);
 engine.tick();assert.equal(engine.getState().instances.length,2);
});
test('a shared start is not replayed to a blueprint when another blueprint later accepts the same record',()=>{
 const [long,short]=overlapBlueprints();long.steps[0].next=['bridge'];long.steps.splice(1,0,{id:'bridge',name:'Bridge',match:{json:{path:'event',equals:'bridge'}},extract:{id:{json:'id',required:true}},next:['ready']});
 short.start='ready';short.steps[0]={...short.steps[0],id:'ready',match:{json:{path:'event',equals:'ready'}}};
 const e=createFlowEngine(()=>0);e.setBlueprints([long,short],'v1');e.ingest([log('init',{id:'x'}),log('ready',{id:'x'}),log('bridge',{id:'x'}),log('done',{id:'x'})]);
 const rows=e.getState().instances;assert.equal(rows.length,2);assert.ok(rows.every(row=>row.outcome==='completed'&&row.completeness==='complete'));
 assert.equal(rows.find(row=>row.blueprint.id==='short')?.observations.filter(row=>row.stepId==='ready').length,1);
});
test('pending evidence cannot start newly installed blueprints or revisions retroactively',()=>{
 const [long]=overlapBlueprints();const e=createFlowEngine(()=>0);e.setBlueprints([long],'v1');e.ingest([log('init',{id:'x'}),log('done',{id:'x'})]);
 const newStart={...long,start:'done',steps:[long.steps[2]]};
 e.setBlueprints([newStart,{...newStart,id:'new-blueprint'}],'v2');e.tick();
 assert.equal(e.getState().instances.length,1);assert.equal(e.getState().instances[0].revision,'v1');
 e.ingest([log('ready',{id:'x'})]);assert.equal(e.getState().instances[0].outcome,'completed');assert.equal(e.getState().instances.length,1);
});
test('queued completion can finish a pinned instance even after its blueprint is removed',()=>{
 const e=createFlowEngine(()=>0);e.setBlueprints(overlapBlueprints(),'v1');e.ingest([log('init',{id:'x'}),log('done',{id:'x'})]);e.setBlueprints([],'v2');e.ingest([log('ready',{id:'x'})]);
 assert.equal(e.getState().instances.length,2);assert.ok(e.getState().instances.every(row=>row.outcome==='completed'&&row.revision==='v1'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createFlowEngine } from '../shared/flow-engine.js';
import { parseFlowBlueprint } from '../shared/flow-blueprints.js';
import { flowPresentation } from '../shared/flow-presentation.js';
import type { FlowBlueprint } from '../shared/flow-types.js';
const blueprint = ():FlowBlueprint => ({version:1,id:'download',name:'Download',start:'start',timeout:'5s',correlation:{scope:'device-session',primary:'id'},steps:[
 {id:'start',name:'Start',match:{json:{path:'event',equals:'start'}},extract:{id:{json:'id',required:true}},next:['progress']},
 {id:'progress',name:'Progress',repeatable:true,match:{json:{path:'event',equals:'progress'}},extract:{id:{json:'id',required:true},percent:{json:'percent',result:true},token:{json:'token'}},label:'Download {progress.percent}%',next:['done']},
 {id:'done',name:'Done',match:{all:[{json:{path:'event',equals:'done'}},{json:{path:'token',equalsFrom:{step:'progress',field:'token'}}}]},outcome:'completed'}
]});
const log=(event:string,fields:object={})=>({timestamp:'now',message:JSON.stringify({event,...fields}),source:{key:'device',name:'Phone',deviceId:'phone',platform:'android' as const}});
function setup(b=blueprint()){let now=0;const engine=createFlowEngine(()=>now);engine.setBlueprints([b],'v1');return {engine,advance(ms:number){now+=ms;engine.tick();},setClock(ms:number){now=ms;}};}
const observations=(e:ReturnType<typeof createFlowEngine>)=>e.getState().instances[0]?.observations;
test('repeatable schema permits phases but rejects start, terminal, malformed and unidentifiable declarations',()=>{
 const b=blueprint();assert.deepEqual(parseFlowBlueprint(JSON.stringify(b)).diagnostics,[]);
 for(const change of [(v:any)=>v.steps[0].repeatable=true,(v:any)=>v.steps[2].repeatable=true,(v:any)=>v.steps[1].repeatable='true',(v:any)=>delete v.steps[1].extract.id,(v:any)=>v.steps[1].next=['progress']]){const v=structuredClone(b);change(v);assert.ok(parseFlowBlueprint(JSON.stringify(v)).diagnostics.length);}
 const ref=structuredClone(b);delete ref.steps[1].extract!.id;ref.steps[1].match={all:[{json:{path:'event',equals:'progress'}},{json:{path:'id',equalsFrom:{step:'start',field:'id'}}}]};assert.deepEqual(parseFlowBlueprint(JSON.stringify(ref)).diagnostics,[]);
});
test('all repeat occurrences update label/results, keep window open, and downstream references use latest accepted payload',()=>{
 const {engine:e}=setup();e.ingest([log('start',{id:'a'}),log('progress',{id:'a',percent:10,token:'old'}),log('progress',{id:'a',percent:80,token:'new'})]);
 const i=e.getState().instances[0];assert.equal(i.observations.length,3);assert.deepEqual(i.expected,['progress','done']);assert.equal(flowPresentation(i).label.map(p=>p.text).join(''),'Download 80%');assert.equal(flowPresentation(i).results[0].value,80);
 e.ingest([log('done',{token:'old'})]);assert.equal(e.getState().instances[0].outcome,'running');e.ingest([log('done',{token:'new'})]);const done=e.getState().instances[0];assert.equal(done.outcome,'completed');assert.ok(done.observations.at(-1)!.matchedBy!.some(v=>v.includes('"new"')));
});
test('optional repeat may have zero occurrences; mandatory phase needs at least one',()=>{
 const b=blueprint();b.steps[2].match={json:{path:'event',equals:'done'}};b.steps[2].extract={id:{json:'id',required:true}};
 const mandatory=setup(b);mandatory.engine.ingest([log('start',{id:'a'}),log('done',{id:'a'})]);assert.equal(mandatory.engine.getState().instances[0].outcome,'running');mandatory.engine.ingest([log('progress',{id:'a',percent:5})]);assert.equal(mandatory.engine.getState().instances[0].outcome,'completed');
 b.steps[0].next=['progress','done'];b.steps[1].optional=true;assert.deepEqual(parseFlowBlueprint(JSON.stringify(b)).diagnostics,[]);const optional=setup(b);optional.engine.ingest([log('start',{id:'a'}),log('done',{id:'a'})]);assert.equal(optional.engine.getState().instances[0].outcome,'completed');assert.equal(observations(optional.engine)!.length,2);
});
test('repeat requires explicit exact identity and isolates concurrent instances',()=>{
 const {engine:e}=setup();e.ingest([log('start',{id:'a'}),log('start',{id:'b'}),log('progress',{percent:1}),log('progress',{id:'wrong',percent:2}),log('progress',{id:'b',percent:3}),log('progress',{id:'a',percent:4})]);assert.deepEqual(e.getState().instances.map(i=>i.observations.map(o=>o.payload.percent).filter(v=>v!==undefined)),[[4],[3]]);
 const b=blueprint();delete b.steps[1].extract!.id;const unsafe=setup(b);unsafe.engine.ingest([log('start',{id:'a'}),log('progress',{percent:50})]);assert.equal(observations(unsafe.engine)!.length,1,'even unvalidated definitions cannot use keyless repeat fallback');
});
test('repeat matches accepted per-instance references without direct correlation extract',()=>{
 const b=blueprint();delete b.steps[1].extract!.id;b.steps[1].match={all:[{json:{path:'event',equals:'progress'}},{json:{path:'operation',equalsFrom:{step:'start',field:'id'}}}]};const {engine:e}=setup(b);e.ingest([log('start',{id:'a'}),log('progress',{operation:'a',percent:10}),log('progress',{operation:'a',percent:20})]);assert.equal(observations(e)!.length,3);
});
test('advancing successor closes the repeat window and repeats never seed missing-start or postterminal flows',()=>{
 const b=blueprint();b.steps[1].next=['verify'];b.steps.splice(2,0,{id:'verify',name:'Verify',match:{json:{path:'event',equals:'verify'}},extract:{id:{json:'id',required:true}},next:['done']});
 const s=setup(b);s.engine.ingest([log('progress',{id:'orphan',percent:1})]);s.advance(2001);assert.equal(s.engine.getState().instances.length,0);
 s.engine.ingest([log('start',{id:'a'}),log('progress',{id:'a',percent:10,token:'t'}),log('verify',{id:'a'}),log('progress',{id:'a',percent:20}),log('done',{token:'t'}),log('progress',{id:'a',percent:30})]);s.advance(2001);assert.equal(s.engine.getState().instances.length,1);assert.deepEqual(observations(s.engine)!.filter(o=>o.stepId==='progress').map(o=>o.payload.percent),[10]);
});
test('deadline is never extended and timed-out repeats are ignored while late ordinary terminal remains supported',()=>{
 const s=setup();s.engine.ingest([log('start',{id:'a'}),log('progress',{id:'a',percent:10,token:'t'})]);s.advance(4000);s.engine.ingest([log('progress',{id:'a',percent:20,token:'t'})]);assert.equal(s.engine.getState().instances[0].timeoutAt,5000);s.advance(1001);s.engine.ingest([log('progress',{id:'a',percent:30,token:'t'}),log('done',{token:'t'})]);assert.equal(observations(s.engine)!.filter(o=>o.stepId==='progress').length,2);assert.equal(s.engine.getState().instances[0].outcome,'timed_out');assert.equal(s.engine.getState().instances[0].lateOutcome,'completed');
 const noTick=setup();noTick.engine.ingest([log('start',{id:'a'})]);noTick.setClock(5001);noTick.engine.ingest([log('progress',{id:'a',percent:1})]);assert.equal(observations(noTick.engine)!.length,1);
});
test('pinned repeat definitions survive snapshot replacement; epoch barriers stop old repeats',()=>{
 const s=setup();s.engine.ingest([log('start',{id:'a'}),log('progress',{id:'a',percent:1})]);s.engine.setBlueprints([],'v2');s.engine.ingest([log('progress',{id:'a',percent:2})]);assert.equal(observations(s.engine)!.length,3);assert.equal(s.engine.getState().instances[0].revision,'v1');s.engine.interrupt();s.engine.ingest([log('progress',{id:'a',percent:3})]);s.advance(2001);assert.equal(observations(s.engine)!.length,3);assert.equal(s.engine.getState().instances.length,1);s.engine.clear();s.engine.ingest([log('progress',{id:'a',percent:4})]);s.advance(2001);assert.equal(s.engine.getState().instances.length,0);
});
test('overlapping eligible repeat/successor matches stay ambiguous and global error wins',()=>{
 const b=blueprint();b.steps[2].match=b.steps[1].match;b.steps[2].extract={id:{json:'id',required:true}};const s=setup(b);s.engine.ingest([log('start',{id:'a'}),log('progress',{id:'a',percent:1}),log('progress',{id:'a',percent:2})]);assert.equal(s.engine.getState().instances[0].completeness,'ambiguous');assert.equal(observations(s.engine)!.length,2);
 const error=blueprint();error.errors=[{id:'failure',appliesTo:'active',match:{json:{path:'event',equals:'progress'}},extract:{id:{json:'id'},code:{json:'code'}},codeField:'code',codes:{},unknownOutcome:'failed'}];const failed=setup(error);failed.engine.ingest([log('start',{id:'a'}),log('progress',{id:'a',code:'NO',percent:3})]);assert.equal(failed.engine.getState().instances[0].outcome,'failed');assert.equal(observations(failed.engine)!.at(-1)!.stepId,'failure');
});
test('repeat bursts retain every accepted occurrence within the evidence budget',()=>{
 const {engine:e}=setup();e.ingest([log('start',{id:'a'})]);e.ingest(Array.from({length:300},(_,n)=>log('progress',{id:'a',percent:n,token:String(n)})));assert.equal(observations(e)!.length,301);assert.equal(flowPresentation(e.getState().instances[0]).results[0].value,299);
});
test('latest repeat occurrence with absent optional field cannot reuse a stale downstream reference',()=>{
 const {engine:e}=setup();e.ingest([log('start',{id:'a'}),log('progress',{id:'a',percent:1,token:'stale'}),log('progress',{id:'a',percent:2}),log('done',{token:'stale'})]);assert.equal(e.getState().instances[0].outcome,'running');assert.equal(observations(e)!.length,3);
});
test('same identity reused by concurrent starts and across revisions remains quarantined',()=>{
 const first=setup();first.engine.ingest([log('start',{id:'a'}),log('start',{id:'a'}),log('progress',{id:'a',percent:10})]);assert.equal(first.engine.getState().instances.length,1);assert.equal(first.engine.getState().instances[0].completeness,'ambiguous');assert.equal(observations(first.engine)!.length,1);
 const s=setup();s.engine.ingest([log('start',{id:'a'})]);s.engine.setBlueprints([blueprint()],'v2');s.engine.ingest([log('start',{id:'a'}),log('progress',{id:'a',percent:1})]);assert.equal(s.engine.getState().instances.length,2);assert.ok(s.engine.getState().instances.every(i=>i.completeness==='ambiguous'&&i.observations.length===1));
});
test('large repeat evidence reaches the existing budget with visible gap instead of silent history compaction',()=>{
 const {engine:e}=setup();e.ingest([log('start',{id:'a'})]);const blob='x'.repeat(60000);for(let n=0;n<300;n++)e.ingest([log('progress',{id:'a',percent:n,blob})]);const state=e.getState();assert.ok(state.gaps>0);assert.equal(state.instances.length,0);
});
test('late repeat evidence cannot attach to a new instance reusing an old identity',()=>{
 const s=setup();s.engine.ingest([log('start',{id:'a'}),log('progress',{id:'a',percent:1,token:'t'}),log('done',{token:'t'}),log('progress',{id:'a',percent:99}),log('start',{id:'a'})]);assert.equal(s.engine.getState().instances.length,2);assert.equal(s.engine.getState().instances[1].observations.length,1);
});
test('pending repeat belongs to original instance and cannot migrate after an optional bypass',()=>{
 const b=blueprint();b.steps[0].next=['bridge','done'];b.steps.splice(1,0,{id:'bridge',name:'Bridge',match:{json:{path:'event',equals:'bridge'}},extract:{id:{json:'id'}},next:['progress']});b.steps.at(-1)!.match={json:{path:'event',equals:'done'}};b.steps.at(-1)!.extract={id:{json:'id'}};
 const s=setup(b);s.engine.ingest([log('start',{id:'a'}),log('progress',{id:'a',percent:99}),log('done',{id:'a'}),log('start',{id:'a'}),log('bridge',{id:'a'})]);assert.equal(s.engine.getState().instances[1].observations.length,2);assert.equal(s.engine.getState().instances[1].expected[0],'progress');
});
test('out-of-order repeat waits for a reachable phase only in the original same-identity instance',()=>{
 const b=blueprint();b.steps[0].next=['bridge'];b.steps.splice(1,0,{id:'bridge',name:'Bridge',match:{json:{path:'event',equals:'bridge'}},extract:{id:{json:'id'}},next:['progress']});const s=setup(b);s.engine.ingest([log('start',{id:'a'}),log('progress',{id:'a',percent:10}),log('bridge',{id:'a'})]);assert.deepEqual(observations(s.engine)!.map(o=>o.stepId),['start','bridge','progress']);
});

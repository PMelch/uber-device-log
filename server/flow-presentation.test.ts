import test from 'node:test';
import assert from 'node:assert/strict';
import { flowPresentation, flowPresentationHistory } from '../shared/flow-presentation.js';
import { parseFlowBlueprint } from '../shared/flow-blueprints.js';
import type { FlowBlueprint, FlowInstance, FlowObservation } from '../shared/flow-types.js';
const blueprint = (): FlowBlueprint => ({version:1,id:'purchase',name:'Purchase',start:'start',timeout:'90s',correlation:{scope:'device-session',primary:'id'},steps:[{id:'start',name:'Start',match:{contains:'start'},extract:{id:{json:'id',required:true}},next:['done']},{id:'done',name:'Done',match:{contains:'done'},extract:{balance:{json:'balance'}},outcome:'completed'}]});
const observation = (stepId:string,payload:Record<string,unknown>,accepted?:boolean): FlowObservation => ({stepId,payload,receivedAt:0,message:{timestamp:'now',message:'original'},...(accepted===undefined?{}:{accepted})});
const instance = (b:FlowBlueprint,observations:FlowObservation[]): FlowInstance => ({id:'one',epoch:0,blueprint:b,revision:'pinned',deviceId:'device',outcome:'completed',completeness:'complete',startedAt:0,updatedAt:0,timeoutAt:90000,observations,expected:[],bindings:{}});
const text = (value:ReturnType<typeof flowPresentation>) => value.label.map(p=>p.text).join('');
test('backward compatible labels fall back to authored blueprint name',()=> assert.deepEqual(flowPresentation(instance(blueprint(),[])),{label:[{text:'Purchase'}],results:[]}));
test('labels freeze at acceptance with literal and styled substitutions; unlabeled steps preserve them',()=> {
 const b:any=blueprint();b.label='Buying {start.id}';b.steps[1].label=[{text:'Done: ',tone:'success'},{text:'{done.balance}',tone:'info'}];
 const first=instance(b,[observation('start',{id:'a'}),observation('done',{balance:0})]);
 assert.deepEqual(flowPresentation(first).label,[{text:'Done: ',tone:'success'},{text:'0',tone:'info'}]);
 b.steps.push({id:'later',name:'Later',match:{contains:'later'},extract:{balance:{json:'balance'}}});
 first.observations.push(observation('later',{balance:10}));
 assert.equal(text(flowPresentation(first)),'Done: 0');
});
test('missing or non-scalar substitutions preserve previous label without exposing placeholders',()=> {
 const b:any=blueprint();b.label='Buying {start.id}';b.steps[1].label='Balance {done.balance}';
 for (const payload of [{},{balance:undefined},{balance:{amount:1}},{balance:Infinity}]) assert.equal(text(flowPresentation(instance(b,[observation('start',{id:'a'}),observation('done',payload)]))),'Buying a');
});
test('rejected observations cannot change labels or publish result fields',()=> {
 const b:any=blueprint();b.steps[0].label='Buying {start.id}';b.steps[1].label='Done {done.balance}';b.steps[1].extract.balance.result=true;
 const value=flowPresentation(instance(b,[observation('start',{id:'a'}),observation('done',{balance:10},false)]));assert.equal(text(value),'Buying a');assert.deepEqual(value.results,[]);
});
test('sensitive substitutions split only the substituted value; results preserve sensitivity',()=> {
 const b:any=blueprint();b.steps[0].extract.id.sensitive=true;b.steps[0].extract.id.result=true;b.steps[0].label=[{text:'Order {start.id} pending',tone:'warning'}];
 const value=flowPresentation(instance(b,[observation('start',{id:'SECRET'})]));
 assert.deepEqual(value.label,[{text:'Order ',tone:'warning'},{text:'SECRET',tone:'warning',sensitive:true},{text:' pending',tone:'warning'}]);
 assert.deepEqual(value.results,[{field:'id',stepId:'start',value:'SECRET',sensitive:true}]);
});
test('latest present accepted result by field name wins; absent optional values do not erase it',()=> {
 const b:any=blueprint();b.steps[0].extract.balance={json:'balance',result:true};b.steps[1].extract.balance.result=true;
 const run=instance(b,[observation('start',{id:'a',balance:5}),observation('done',{})]);assert.deepEqual(flowPresentation(run).results,[{field:'balance',stepId:'start',value:5}]);
 run.observations.push(observation('done',{balance:null}));assert.deepEqual(flowPresentation(run).results,[{field:'balance',stepId:'done',value:null}]);
});
test('known error code label overrides error rule label; unknown codes use rule label',()=> {
 const b:any=blueprint();b.steps[0].label='Buying {start.id}';b.errors=[{id:'failure',appliesTo:'active',match:{contains:'error'},extract:{code:{json:'code',result:true}},codeField:'code',codes:{NO:{description:'No',outcome:'failed',label:[{text:'Declined {start.id}',tone:'error'}]}},unknownOutcome:'failed',label:'Error {failure.code}'}];
 assert.equal(text(flowPresentation(instance(b,[observation('start',{id:'a'}),observation('failure',{code:'NO'})]))),'Declined a');
 assert.equal(text(flowPresentation(instance(b,[observation('start',{id:'a'}),observation('failure',{code:'NEW'})]))),'Error NEW');
});
test('pinned blueprint and branch observations determine label; substituted values are bounded',()=> {
 const b:any=blueprint();b.steps[1].label='Got {start.id}';
 assert.equal(text(flowPresentation(instance(b,[observation('start',{id:'x'.repeat(5000)}),observation('done',{})]))).length,4+4096);
 const other:any=structuredClone(b);other.steps[1].label='Different';assert.equal(text(flowPresentation(instance(other,[observation('done',{})]))),'Different');
});
test('schema accepts label and result metadata and validates graph provenance',()=> {
 const b:any=blueprint();b.label='Purchase {start.id}';b.steps[1].label=[{text:'{start.id}: {done.balance}',tone:'success'}];b.steps[1].extract.balance.result=true;
 assert.deepEqual(parseFlowBlueprint(JSON.stringify(b)).diagnostics,[]);
 for (const mutate of [(v:any)=>v.label='{done.balance}',(v:any)=>v.steps[0].label='{done.balance}',(v:any)=>v.steps[1].label='{unknown.id}',(v:any)=>v.steps[1].label=[{text:'x',tone:'pink'}],(v:any)=>v.steps[1].extract.balance.result='yes',(v:any)=>v.steps[1].label='{start.missing}',(v:any)=>v.steps[1].label='{start.__proto__}',(v:any)=>v.steps[1].label='Value {start.id']) {const copy=structuredClone(b);mutate(copy);assert.ok(parseFlowBlueprint(JSON.stringify(copy)).diagnostics.length);}
});
test('branch labels permit self and common predecessor fields but reject alternative/optional route dependencies',()=> {
 const b:any=blueprint();b.steps[0].next=['ios','android'];b.steps.splice(1,0,{id:'ios',name:'iOS',match:{contains:'ios'},extract:{store:{json:'store'}},next:['done'],label:'App Store {start.id}: {ios.store}'},{id:'android',name:'Android',match:{contains:'android'},extract:{store:{json:'store'}},next:['done'],label:'Play Store {android.store}'});
 b.steps.at(-1).label='{start.id} done';assert.deepEqual(parseFlowBlueprint(JSON.stringify(b)).diagnostics,[]);
 assert.equal(text(flowPresentation(instance(b,[observation('start',{id:'a'}),observation('android',{store:'Play'}),observation('ios',{store:'rejected'},false)]))),'Play Store Play');
 b.steps.at(-1).label='{ios.store}';assert.ok(parseFlowBlueprint(JSON.stringify(b)).diagnostics.some(d=>d.message.includes('every incoming route')));
});
test('error-code labels validate references and keep prior text when earlier context is unavailable',()=> {
 const b:any=blueprint();b.errors=[{id:'failure',appliesTo:'active',match:{contains:'error'},extract:{code:{json:'code',result:true}},codeField:'code',codes:{NO:{description:'No',outcome:'failed',label:'Declined {start.id}'}},unknownOutcome:'failed',label:[{text:'Failure {failure.code}',tone:'error'}]}];
 assert.deepEqual(parseFlowBlueprint(JSON.stringify(b)).diagnostics,[]);
 assert.equal(text(flowPresentation(instance(b,[observation('failure',{code:'NO'})]))),'Purchase');
 b.errors[0].codes.NO.label='{nonexistent.value}';assert.ok(parseFlowBlueprint(JSON.stringify(b)).diagnostics.length);
});
test('template shape and expansion limits reject malformed input without throwing',()=> {
 for (const label of [[],{},null,1,[{text:'x',html:true}],[{text:'x',sensitive:true}],[{text:''}],Array.from({length:33},()=>({text:'x'})),'x'.repeat(4097),'{start.id}'.repeat(65),'{{start.id}}','{start.id} {']) {
  const b:any=blueprint();b.label=label;assert.doesNotThrow(()=>assert.ok(parseFlowBlueprint(JSON.stringify(b)).diagnostics.length),JSON.stringify(label));
 }
 const b:any=blueprint();b.steps[0].label='Value {start.id}';assert.equal(text(flowPresentation(instance(b,[observation('start',{id:false})]))),'Value false');assert.equal(text(flowPresentation(instance(b,[observation('start',{id:null})]))),'Purchase');
});
test('step and extracted field names containing dots resolve unambiguously',()=> {
 const b:any=blueprint();b.start='start.node';b.steps[0].id='start.node';b.steps[0].extract['order.id']={json:'id'};b.label='{start.node.order.id}';
 assert.deepEqual(parseFlowBlueprint(JSON.stringify(b)).diagnostics,[]);assert.equal(text(flowPresentation(instance(b,[observation('start.node',{'order.id':'xyz'})]))),'xyz');
});
test('step and error IDs share one namespace for unambiguous observation provenance',()=> {
 const b:any=blueprint();b.errors=[{id:'done',appliesTo:'active',match:{contains:'failure'},extract:{code:{json:'code'}},codeField:'code',codes:{},unknownOutcome:'failed',label:'Error {done.code}'}];
 assert.ok(parseFlowBlueprint(JSON.stringify(b)).diagnostics.some(d=>d.message.includes('Duplicate')));
});

test('presentation history scans each observation once and preserves immutable prefix results', () => {
 const b = blueprint();
 b.steps[1]!.label = 'Progress {done.balance}';
 b.steps[1]!.extract!.balance!.result = true;
 let reads = 0;
 const rows = Array.from({ length: 2000 }, (_, index) => {
  const row = observation('done', { balance: index });
  Object.defineProperty(row, 'accepted', { get() { reads++; return index % 7 === 0 ? false : true; } });
  return row;
 });
 const run = instance(b, rows);
 const history = flowPresentationHistory(run);
 assert.equal(history.length, rows.length);
 assert.equal(reads, rows.length, 'each occurrence is visited once, rather than replaying every prefix');
 assert.equal(text(history[0]!), 'Purchase');
 assert.equal(text(history[1]!), 'Progress 1');
 assert.equal(history[1]!.results[0]!.value, 1, 'later updates never mutate earlier result snapshots');
 assert.equal(history[7]!.results[0]!.value, 6, 'unaccepted evidence preserves previous state');
 assert.deepEqual(history.at(-1), flowPresentation(run));
 for (const index of [0, 1, 7, 500, 1999]) assert.deepEqual(history[index], flowPresentation(instance(b, rows.slice(0, index + 1))));
});

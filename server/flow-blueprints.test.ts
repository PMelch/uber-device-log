import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFlowBlueprint } from '../shared/flow-blueprints.js';
const base = `version: 1\nid: login\nname: Login\nstart: start\ntimeout: 30s\ncorrelation: {scope: device-session, primary: id}\nsteps:\n  - id: start\n    name: Start\n    match: {contains: login}\n    extract: {id: {json: id, required: true}}\n    next: [done]\n  - id: done\n    name: Done\n    match: {json: {path: id, equalsFrom: {step: start, field: id}}}\n    outcome: completed\n`;
test('accepts graph and payload references', () => assert.equal(parseFlowBlueprint(base).blueprint?.id, 'login'));
test('timeout milliseconds remain finite positive safe integers at every unit boundary', () => {
 for (const [unit, scale] of [['ms', 1], ['s', 1000], ['m', 60000], ['h', 3600000]] as const) {
   const limit = Math.floor(Number.MAX_SAFE_INTEGER / scale);
   assert.deepEqual(parseFlowBlueprint(base.replace('30s', `${limit}${unit}`)).diagnostics, [], `${unit}: maximum safe duration`);
   for (const duration of [`${limit + 1}${unit}`, `${'9'.repeat(400)}${unit}`]) {
     const parsed = parseFlowBlueprint(base.replace('30s', duration));
     assert.equal(parsed.blueprint, undefined, duration);
     assert.ok(parsed.diagnostics.some(item => item.path === 'timeout'), duration);
   }
 }
});
test('authored step IDs beginning error: keep ordinary dominating equalsFrom references', () => {
 const parsed = parseFlowBlueprint(base.replace('next: [done]', "next: ['error:0']").replace('id: done', "id: 'error:0'"));
 assert.deepEqual(parsed.diagnostics, []);
 assert.equal(parsed.blueprint?.steps[1]?.id, 'error:0');
 // Actual error matchers still cannot reference step payloads.
 const errorRule = `${base}errors:\n  - id: failure\n    appliesTo: active\n    match: {json: {path: id, equalsFrom: {step: start, field: id}}}\n    extract: {code: {json: code}}\n    codeField: code\n    codes: {}\n    unknownOutcome: failed\n`;
 assert.ok(parseFlowBlueprint(errorRule).diagnostics.some(item => item.message.includes('every incoming route')));
});
test('rejects unknown fields, aliases, duplicate keys, cycles and future references', () => {
 for (const source of [base+'surprise: true\n', base+'name: Duplicate\n', base.replace('contains: login','contains: &x login').replace('path: id','path: *x'), base.replace('outcome: completed','next: [start]'), base.replace('step: start, field: id','step: done, field: id')]) assert.ok(parseFlowBlueprint(source).diagnostics.length);
});
test('rejects invalid regex and unsafe fields', () => {
 assert.ok(parseFlowBlueprint(base.replace('contains: login', "regex: '['")).diagnostics.length);
 assert.ok(parseFlowBlueprint(base.replace('json: id','json: __proto__.id')).diagnostics.length);
});
test('regex extractors must name an existing capture group', () => {
 assert.ok(parseFlowBlueprint(base.replace('json: id, required: true', "regex: '(?<other>id)', group: wanted, required: true")).diagnostics.length);
});
test('payload dependency must dominate consumer across all routes', () => {
 const branching = base.replace('next: [done]','next: [middle, done]').replace('  - id: done',`  - id: middle\n    name: Optional\n    optional: true\n    match: {contains: middle}\n    extract: {token: {json: token}}\n    next: [done]\n  - id: done`).replace('step: start, field: id','step: middle, field: token');
 assert.ok(parseFlowBlueprint(branching).diagnostics.some(d => d.message.includes('every incoming route')));
});
test('malformed optional graph edges report diagnostics without throwing', () => {
 for (const next of ['true','wrong','42']) assert.ok(parseFlowBlueprint(base.replace('outcome: completed',`optional: true\n    next: ${next}`)).diagnostics.length);
});
test('dense DAG dependency validation stays bounded instead of enumerating every route', async () => {
 const { execFile } = await import('node:child_process');
 const { promisify } = await import('node:util');
 const graph = {version:1,id:'dense',name:'Dense',start:'s0',timeout:'5s',correlation:{scope:'device-session',primary:'id'},steps:Array.from({length:35},(_,i)=>({id:`s${i}`,name:`Step ${i}`,match:i===34 ? {json:{path:'id',equalsFrom:{step:'s0',field:'id'}}} : {contains:`step-${i}`},...(i===0 ? {extract:{id:{json:'id',required:true}}}:{}),...(i===34 ? {outcome:'completed'} : {next:Array.from({length:34-i},(_,j)=>`s${i+j+1}`)})}))};
 const script = `import {parseFlowBlueprint} from './shared/flow-blueprints.ts';const p=parseFlowBlueprint(${JSON.stringify(JSON.stringify(graph))});if(!p.blueprint)throw new Error(JSON.stringify(p.diagnostics));`;
 await promisify(execFile)(process.execPath,['--import','tsx','--input-type=module','-e',script],{cwd:process.cwd(),timeout:2000});
});
test('malformed schema shapes always produce diagnostics instead of exceptions', async () => {
 const { parse } = await import('yaml');
 const original = parse(base);
 const malformed = [null, true, 42, 'wrong', [], {wrong:true}];
 const paths = [['steps'],['correlation'],['steps',0],['steps',0,'id'],['steps',0,'next'],['steps',0,'match'],['steps',0,'extract'],['steps',1,'match','json'],['steps',1,'match','json','equalsFrom']];
 for (const path of paths) for (const value of malformed) {
   const blueprint = structuredClone(original); let target = blueprint;
   for (const key of path.slice(0,-1)) target = target[key];
   target[path.at(-1)!] = value;
   assert.doesNotThrow(() => assert.ok(parseFlowBlueprint(JSON.stringify(blueprint)).diagnostics.length),`${path.join('.')} ${JSON.stringify(value)}`);
 }
});
test('blueprint priority accepts all five levels and preserves omission for display default 3', () => {
 const original = parseFlowBlueprint(base).blueprint!;
 assert.equal(Object.hasOwn(original, 'priority'), false);
 for (const priority of [1,2,3,4,5]) {
   const parsed = parseFlowBlueprint(`${base}priority: ${priority}\n`);
   assert.deepEqual(parsed.diagnostics, []);
   assert.equal(parsed.blueprint?.priority, priority);
 }
});
test('priority must be an actual integer number from 1 to 5 with a located diagnostic', () => {
 for (const value of ['"1"','null','true','false','0','6','1.5','[]','{}','.nan','.inf']) {
   const parsed = parseFlowBlueprint(`${base}priority: ${value}\n`);
   assert.equal(parsed.blueprint, undefined);
   assert.ok(parsed.diagnostics.some(diagnostic => diagnostic.path === 'priority'), value);
 }
});

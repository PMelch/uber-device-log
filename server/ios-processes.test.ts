import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIosProcess, observedIosProcesses } from '../shared/ios-processes.js';
import { defaultSourceFilter, filterSourceMessages, createSourceFilterer } from '../shared/log-sources.js';
import { serializeLogExport } from '../shared/log-export.js';
const source = { key: 'ios:test', deviceId: 'test', name: 'Phone', platform: 'ios' as const };
const raw = 'Nov  6 07:50:00 iPhone MyApp(Core)[0] <Notice>: hello\n  continuation Other[12]';
const entry = (name = 'MyApp', pid = 0) => ({ timestamp: 'receipt', message: raw, source, processName: name, pid });
test('anchored known iOS headers preserve zero PID and ignore component', () => {
  assert.deepEqual(parseIosProcess(raw), { processName: 'MyApp', pid: 0 });
  assert.deepEqual(parseIosProcess('2026-11-06 07:50:00.123+0100 MyApp[123:456] hello'), { processName: 'MyApp', pid: 123 });
  assert.deepEqual(parseIosProcess('Nov 6 07:50:00 MyApp[2] <Error>: hello'), { processName: 'MyApp', pid: 2 });
});
test('unknown malformed and body-only headers never infer process metadata', () => {
  for (const text of ['MyApp[1]: hello', 'prefix '+raw, '\n'+raw, 'Nov 6 07:50:00 iPhone MyApp[-1] <Notice>: x', 'Nov 6 07:50:00 iPhone MyApp[1x] <Notice>: x', 'Nov 6 07:50:00 iPhone MyApp[9007199254740992] <Notice>: x', 'Bog 6 07:50:00 iPhone MyApp[1] <Notice>: x', 'Nov 6 99:50:00 iPhone MyApp[1] <Notice>: x', 'Nov 6 07:50:00\niPhone MyApp[1] <Notice>: x', 'Nov 6 07:50:00 iPhone MyApp[1] nonsense']) assert.equal(parseIosProcess(text), undefined, text);
});
test('observed list deduplicates names from unfiltered retained native logs, resets and bounds', () => {
  const rows = [entry(), entry('Other', 2), entry('MyApp', 9), { ...entry('Web', 4), source: { ...source, webview: {id:'w',socket:'s',title:'t',url:''} } }];
  assert.deepEqual(observedIosProcesses(rows, source.key), [{ name: 'MyApp', pid: 9 }, { name: 'Other', pid: 2 }]);
  assert.deepEqual(observedIosProcesses([], source.key), []);
  assert.equal(observedIosProcesses(rows, source.key, 1).length, 1);
});
test('name follows restart; exact PID including zero narrows; cache invalidates; exports retain raw', () => {
  const rows = [entry(), entry('Other',2), entry('MyApp',9)];
  const filters = { [source.key]: { ...defaultSourceFilter(), processName: 'MyApp' } };
  for (const filter of [filterSourceMessages, createSourceFilterer()]) {
    assert.deepEqual(filter(rows, filters), [rows[0],rows[2]]);
    filters[source.key]!.pid = '0'; assert.deepEqual(filter(rows, filters), [rows[0]]);
    filters[source.key]!.pid = 'bad'; assert.deepEqual(filter(rows, filters), []);
    filters[source.key]!.pid = '';
  }
  const device = {id:'test', name:'Phone',platform:'ios' as const,state:'connected'};
  const json = JSON.parse(serializeLogExport([rows[0]!], device, 'json').text);
  assert.equal(json.entries[0].processName, 'MyApp'); assert.equal(json.entries[0].message, raw);
  assert.equal(serializeLogExport([rows[0]!], device, 'text').text, '[Phone] receipt '+raw);
});

test('unknown messages pass without filters; native iOS selection never changes Android or WebViews', () => {
  const unknown = { timestamp: 'receipt', message: 'body MyApp[9]', source };
  assert.deepEqual(filterSourceMessages([unknown], { [source.key]: defaultSourceFilter() }), [unknown]);
  assert.deepEqual(filterSourceMessages([unknown], { [source.key]: { ...defaultSourceFilter(), processName: 'MyApp' } }), []);
  for (const origin of [{ ...source, platform: 'android' as const }, { ...source, webview: { id:'w',socket:'s',title:'t',url:'' } }]) {
    const row = { ...entry(), source: origin };
    assert.deepEqual(filterSourceMessages([row], { [source.key]: { ...defaultSourceFilter(), processName: 'Absent' } }), [row]);
  }
  const cached = createSourceFilterer(), rows = [entry(), entry('Other',2)];
  assert.deepEqual(cached(rows, { [source.key]: {...defaultSourceFilter(),processName:'MyApp'} }), [rows[0]]);
  assert.deepEqual(cached(rows, { [source.key]: {...defaultSourceFilter(),processName:'Other'} }), [rows[1]]);
});
test('observations follow source identity and retained buffer replacement, never neighboring metadata', () => {
  const rows = [entry(), entry('Other',2)];
  assert.deepEqual(observedIosProcesses(rows, 'different-device'), []);
  assert.deepEqual(observedIosProcesses(rows.slice(1), source.key), [{ name:'Other',pid:2 }]);
  assert.deepEqual(observedIosProcesses([{timestamp:'now',message:'continuation',source}],source.key), []);
  assert.deepEqual(observedIosProcesses(Array.from({length:1100},(_,i)=>entry('Process'+i,i)),source.key).length,1000);
});

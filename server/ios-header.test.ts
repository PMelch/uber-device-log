import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIosHeader } from '../shared/ios-header.js';
const raw = 'Nov  6	08:35:36 funstages-iPhone-11 BloomBoomCasino(AudioToolbox)[662] <Notice>: SSClientCompletion.cpp:83 Calling client...\r\n  <script>alert(1)</script>';
test('header spans preserve every original code unit and exact offsets', () => {
 const parts = parseIosHeader(raw)!; assert.ok(parts);
 assert.equal(parts.map(p => raw.slice(p.start,p.end)).join(''),raw);
 assert.deepEqual(parts.filter(p=>p.kind).map(p=>[p.kind,raw.slice(p.start,p.end)]), [['timestamp','Nov  6	08:35:36'],['device','funstages-iPhone-11'],['process','BloomBoomCasino'],['subsystem','(AudioToolbox)'],['pid','[662]'],['notice','<Notice>']]);
 assert.equal(parts.at(-1)!.end,raw.length);
});
test('known ISO numeric forms and explicit localized month tokens', () => {
 for(const value of ['2026-11-06 08:35:36.123+0100 App[12:34] body','2026-11-06T08:35:36Z phone App(Core)[0] <Error>: body','Mär 6 08:35:36 phone App[2] <Warning>: body','févr. 6 08:35:36 App[2] <Debug>: body','nov. 6 08:35:36 phone App[2] <Notice>: body']) {
 const parts=parseIosHeader(value); assert.ok(parts,value); assert.equal(parts.map(p=>value.slice(p.start,p.end)).join(''),value);
 }
});
test('unknown ambiguous malformed and unanchored headers remain raw', () => {
 for(const value of ['prefix '+raw,'\n'+raw,raw.replace('Nov','Bog'),raw.replace('08:35','28:35'),raw.replace('[662]','[9007199254740992]'),raw.replace('Nov  6','06/11/26'),raw.replace('Nov  6','11月 6'),raw.replace(' <Notice>:', '\n<Notice>:'),'2026-13-06 08:35:36 App[1:2] body']) assert.equal(parseIosHeader(value),undefined,value);
});
test('malicious text is only source offsets, never generated HTML', () => {
 const value='Nov 6 08:35:36 phone <img/src=x>[2] <Notice>: <script>x</script>';
 const parts=parseIosHeader(value)!; assert.ok(parts); assert.equal(parts.map(p=>value.slice(p.start,p.end)).join(''),value);
});

test('severity spellings retain labels, unknown levels remain neutral', () => {
 for (const [label,kind] of Object.entries({Debug:'debug',Info:'info',Default:'level',Notice:'notice',Warning:'warning',Error:'error',Fault:'fatal',Critical:'fatal',Alert:'fatal',Emergency:'fatal',Custom:'level'})) {
  const value=raw.replace('<Notice>','<'+label+'>');
  const span=parseIosHeader(value)!.find(p=>value.slice(p.start,p.end)==='<'+label+'>');
  assert.equal(span?.kind,kind);
 }
});

test('presentation parsing leaves clipboard and export byte-for-byte unchanged', async () => {
 const {formatLogMessages}=await import('../shared/log-view.js');
 const {serializeLogExport}=await import('../shared/log-export.js');
 const entry={timestamp:'receipt',message:raw};
 const device={id:'test',name:'Phone',platform:'ios' as const,state:'connected'};
 const before=formatLogMessages([entry]);
 parseIosHeader(entry.message);
 assert.equal(entry.message,raw);
 assert.equal(formatLogMessages([entry]),before);
 assert.equal(JSON.parse(serializeLogExport([entry],device,'json').text).entries[0].message,raw);
});

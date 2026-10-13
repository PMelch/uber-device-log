import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createInspectorPool } from './ios-inspector.js';

test('iOS discovery and consoles share USB, route page traffic and release independently',async()=>{
  let opened=0,closed=0,receive=(_:any)=>{};const sent:any[]=[];
  const pool=createInspectorPool(async()=>{opened++;return {_socketClient:Object.assign(new EventEmitter(),{destroy(){closed++}}),_decoder:Object.assign(new EventEmitter(),{destroy(){}}),listenMessage(cb){receive=cb},sendMessage(m){sent.push(m)}}});
  const [a,b]=await Promise.all([pool('phone'),pool('phone')]);assert.equal(opened,1);
  const messagesA:any[]=[],messagesB:any[]=[];a.listenMessage(m=>messagesA.push(m));b.listenMessage(m=>messagesB.push(m));
  a.sendMessage({__selector:'_rpc_forwardSocketSetup:',__argument:{WIRSenderKey:'a'}});
  b.sendMessage({__selector:'_rpc_forwardSocketSetup:',__argument:{WIRSenderKey:'b'}});
  assert.equal(sent[0].__argument.WIRConnectionIdentifierKey,sent[1].__argument.WIRConnectionIdentifierKey);
  receive({__selector:'_rpc_applicationSentData:',__argument:{WIRDestinationKey:'a'}});
  assert.equal(messagesA.length,1);assert.equal(messagesB.length,0);
  a._socketClient.destroy();assert.equal(closed,0);
  receive({__selector:'_rpc_applicationSentListing:',__argument:{}});assert.equal(messagesA.length,1);assert.equal(messagesB.length,1);
  b._socketClient.destroy();assert.equal(closed,1);
});

test('idle iOS session is reused and discovery receives the current application list',async()=>{
  let opened=0,receive=(_:any)=>{}; const sent:any[]=[];
  const socket=Object.assign(new EventEmitter(),{destroy(){socket.emit('close')}});
  const pool=createInspectorPool(async()=>{opened++;return {_socketClient:socket,_decoder:Object.assign(new EventEmitter(),{destroy(){}}),listenMessage(cb){receive=cb},sendMessage(m){sent.push(m)}}},10000);
  const a=await pool('phone');a.listenMessage(()=>{});
  receive({__selector:'_rpc_reportConnectedApplicationList:',__argument:{WIRApplicationDictionaryKey:{'PID:42':{}}}});a._socketClient.destroy();
  receive({__selector:'_rpc_applicationConnected:',__argument:{WIRApplicationIdentifierKey:'PID:43'}});
  const b=await pool('phone');let apps:any;
  b.listenMessage(m=>{apps=m.__argument.WIRApplicationDictionaryKey});b.sendMessage({__selector:'_rpc_reportIdentifier:',__argument:{}});await Promise.resolve();
  assert.equal(opened,1);assert.deepEqual(Object.keys(apps),['PID:42','PID:43']);assert.equal(sent.length,0);
  b._socketClient.on('close',()=>{});socket.emit('close');
});

test('a hung iOS open is evicted, retry succeeds, and its late socket is destroyed',async()=>{
  let late!: (s:any)=>void, attempts=0, closed=0;
  const make=()=>({_socketClient:Object.assign(new EventEmitter(),{destroy(){closed++}}),_decoder:Object.assign(new EventEmitter(),{destroy(){}}),listenMessage(){},sendMessage(){}});
  const pool=createInspectorPool(async()=>{attempts++;if(attempts===1)return new Promise(resolve=>late=resolve);return make()},0,15);
  await assert.rejects(pool('phone'),/timed out/);const retry=await pool('phone');assert.equal(attempts,2);
  late(make());await Promise.resolve();await Promise.resolve();assert.equal(closed,1);retry._socketClient.destroy();assert.equal(closed,2);
});

test('unhealthy unused iOS sockets are discarded instead of kept alive by polling',async()=>{
  let opened=0,closed=0;const pool=createInspectorPool(async()=>{opened++;return {_socketClient:Object.assign(new EventEmitter(),{destroy(){closed++}}),_decoder:Object.assign(new EventEmitter(),{destroy(){}}),listenMessage(){},sendMessage(){}}},10000);
  const a=await pool('phone');a.invalidate?.();a._socketClient.destroy();assert.equal(closed,1);
  const b=await pool('phone');assert.equal(opened,2);b.invalidate?.();b._socketClient.destroy();
});

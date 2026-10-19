import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { discoverIosWebViews, openIosWebViewLogs, iosConsoleMessage } from './ios-webviews.js';
class Inspector {
  _socketClient = Object.assign(new EventEmitter(), {destroy: () => { this.closed = true; }});
  _decoder = Object.assign(new EventEmitter(), {destroy() {}});
  closed = false;
  callback = (_message: any) => {};
  sent: any[] = [];
  listenMessage(callback: (message: any) => void) { this.callback = callback; }
  sendMessage(message: any) { this.sent.push(message); this.respond?.(message); }
  respond?: (message: any) => void;
  emit(selector: string, argument: any) { this.callback({__selector:selector,__argument:argument}); }
  data(message: any) { this.emit('_rpc_applicationSentData:', {WIRApplicationIdentifierKey:'PID:42',WIRMessageDataKey:Buffer.from(JSON.stringify(message))}); }
}
const view = {id:'2',socket:'PID:42',title:'Slot',url:'http://localhost/game'};
test('iOS discovery lists inspectable pages, skips automation and closes the service', async () => {
  const service = new Inspector();
  service.respond = m => {
    if (m.__selector === '_rpc_reportIdentifier:') service.emit('_rpc_reportConnectedApplicationList:', {WIRApplicationDictionaryKey:{'PID:42':{}}});
    if (m.__selector === '_rpc_forwardGetListing:') service.emit('_rpc_applicationSentListing:', {WIRApplicationIdentifierKey:'PID:42',WIRListingKey:{2:{WIRPageIdentifierKey:2,WIRTypeKey:'WIRTypeWebPage',WIRTitleKey:'Slot',WIRURLKey:view.url},3:{WIRPageIdentifierKey:3,WIRTypeKey:'WIRTypeAutomation'}}});
  };
  assert.deepEqual(await discoverIosWebViews('phone', async()=>service), [{...view,pid:42}]);
  assert.equal(service.closed,true);
});
test('iOS console preserves text, severity, device time and exception stack', () => {
  const message = iosConsoleMessage({text:'TypeError: example',level:'error',type:'log',timestamp:1700000000,stackTrace:{callFrames:[{functionName:'run',url:'app.js',lineNumber:2,columnNumber:4}]}},42);
  assert.equal(message.level,'E'); assert.equal(message.timestamp,'2023-11-14T22:13:20.000Z');
  assert.match(message.message,/TypeError: example\n.*run.*app.js:2:4/);
  assert.equal(message.pid,42);
});
test('iOS target capture waits for Console.enable, delivers logs and closes without late callbacks', async () => {
  const service = new Inspector(), logs: any[] = [], ended: any[] = [];
  service.respond = m => {
    if(m.__selector==='_rpc_forwardSocketSetup:') service.data({method:'Target.targetCreated',params:{targetInfo:{targetId:'page-1',type:'page'}}});
    if(m.__selector==='_rpc_forwardSocketData:') {
      const outer=JSON.parse(m.__argument.WIRSocketDataKey.toString());
      if(outer.method==='Target.sendMessageToTarget') {
        const inner=JSON.parse(outer.params.message);
        service.data({method:'Target.dispatchMessageFromTarget',params:{targetId:'page-1',message:JSON.stringify({id:inner.id,result:{}})}});
      }
    }
  };
  const stop=await openIosWebViewLogs('phone',view,m=>logs.push(m),m=>ended.push(m),async()=>service);
  const log={method:'Target.dispatchMessageFromTarget',params:{targetId:'page-1',message:JSON.stringify({method:'Console.messageAdded',params:{message:{text:'hello',level:'log'}}})}};
  service.data(log); assert.equal(logs[0].message,'hello'); stop(); service.data(log);
  assert.equal(logs.length,1);assert.equal(ended.length,0);assert.equal(service.closed,true);
});

test('iOS initialization errors reject and release the transport', async () => {
  const service = new Inspector();
  service.respond=m=>{ if(m.__selector==='_rpc_forwardSocketSetup:') service.data({error:{message:'Target unavailable'}}); };
  await assert.rejects(openIosWebViewLogs('phone',view,()=>{},()=>{},async()=>service),/Target unavailable/);
  assert.equal(service.closed,true);
});

test('iOS connection failure after ready ends only once', async () => {
  const service = new Inspector(), ended: unknown[]=[];
  service.respond=m=>{
    if(m.__selector==='_rpc_forwardSocketSetup:') service.data({method:'Target.targetCreated',params:{targetInfo:{targetId:'page-1',type:'page'}}});
    if(m.__selector==='_rpc_forwardSocketData:') { const outer=JSON.parse(m.__argument.WIRSocketDataKey);const inner=JSON.parse(outer.params.message);service.data({id:inner.id,result:{}}); }
  };
  await openIosWebViewLogs('phone',view,()=>{},m=>ended.push(m),async()=>service);
  service._socketClient.emit('error',new Error('lost'));service._socketClient.emit('close');
  assert.equal(ended.length,1);assert.equal(service.closed,true);
});

test('incomplete iOS discovery rejects rather than returning a false empty page list', async () => {
  const service=new Inspector();service.respond=m=>{if(m.__selector==='_rpc_reportIdentifier:')service.emit('_rpc_reportConnectedApplicationList:',{WIRApplicationDictionaryKey:{'PID:42':{}}});};
  await assert.rejects(discoverIosWebViews('phone',async()=>service),/timed out/);assert.equal(service.closed,true);
});

test('late iOS service acquisition is closed after the deadline', async () => {
  const service=new Inspector();let finish!: (value:Inspector)=>void;
  const result=discoverIosWebViews('phone',()=>new Promise(resolve=>{finish=resolve}));
  await assert.rejects(result,/connection timed out/);finish(service);await Promise.resolve();assert.equal(service.closed,true);
});

test('WebKit execution routes to the chosen target and wrapper failures leave log capture alive', async () => {
  const { RuntimeConsole } = await import('./runtime-console.js');
  const runtime = new RuntimeConsole('ios', 100);
  const service = new Inspector(), ended: unknown[] = [], logs: unknown[] = [];
  const nested = (packet: unknown) => service.data({ method: 'Target.dispatchMessageFromTarget', params: { targetId: 'page-1', message: JSON.stringify(packet) } });
  service.respond = message => {
    if (message.__selector === '_rpc_forwardSocketSetup:') service.data({ method: 'Target.targetCreated', params: { targetInfo: { targetId: 'page-1', type: 'page' } } });
    if (message.__selector !== '_rpc_forwardSocketData:') return;
    const outer = JSON.parse(message.__argument.WIRSocketDataKey.toString()), inner = JSON.parse(outer.params.message);
    if (inner.method === 'Runtime.evaluate') { service.data({ id: outer.id, error: { message: 'Target unavailable' } }); return; }
    service.data({ id: outer.id, result: {} });
    if (inner.method === 'Runtime.enable') nested({ method: 'Runtime.executionContextCreated', params: { context: { id: 3, frameId: 'root', type: 'normal', name: '' } } });
    nested({ id: inner.id, result: inner.method === 'Page.getResourceTree' ? { frameTree: { frame: { id: 'root', url: 'https://example.com' } } } : {} });
  };
  const stop = await openIosWebViewLogs('phone', view, m => logs.push(m), m => ended.push(m), async () => service, runtime);
  await runtime.enable();
  assert.equal(runtime.state().contexts[0].top, true);
  await assert.rejects(runtime.evaluate(runtime.state().contexts[0].key, 0, 'document.title'), /consoleUnavailable/);
  nested({ method: 'Console.messageAdded', params: { message: { text: 'still capturing', level: 'log' } } });
  assert.equal(logs.length, 1); assert.equal(ended.length, 0); assert.equal(service.closed, false);
  stop();
});

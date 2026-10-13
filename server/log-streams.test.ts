import assert from 'node:assert/strict';
import test from 'node:test';
import { createLogStreams, type LogStream, type StreamSource } from '../src/log-streams';
class Stream implements LogStream {
  callbacks = new Map<string, (event: {data:string}) => void>();
  onerror: (() => void) | null = null;
  closed = 0;
  addEventListener(type: string, callback: (event: {data:string}) => void) { this.callbacks.set(type, callback); }
  close() { this.closed++; }
  emit(type: string, data: unknown) { this.callbacks.get(type)?.({data: JSON.stringify(data)}); }
}
const phone: StreamSource = {key:'android:phone',device:{id:'phone',name:'Pixel',platform:'android',state:'connected'}};
const web: StreamSource = {key:'web:slot',device:{...phone.device,webview:{id:'page-1',socket:'webview_devtools_remote_42',title:'Slot',url:''}}};

test('sources capture concurrently, toggles close only removed source, stale callbacks are ignored', () => {
 const streams: Stream[] = []; const urls: string[] = []; const received: string[] = [];
 const manager=createLogStreams({logs:source=>received.push(source.key),status:()=>{}},url=>{urls.push(url);const s=new Stream();streams.push(s);return s;});
 manager.sync([phone,web]); assert.equal(streams.length,2); assert.match(urls[1],/webviewId=page-1/);
 streams[0].emit('logs',[{timestamp:'now',message:'phone'}]);streams[1].emit('logs',[{timestamp:'now',message:'web'}]);
 assert.deepEqual(received,[phone.key,web.key]);
 manager.sync([web]); assert.equal(streams[0].closed,1);assert.equal(streams[1].closed,0);
 streams[0].emit('logs',[]);assert.equal(received.length,2);
 manager.close();assert.equal(streams[1].closed,1);
});
test('a failed WebView leaves native capture running and does not reconnect until explicitly removed/readded',()=>{
 const streams: Stream[]=[];const status: Array<[string,boolean]>=[];
 const manager=createLogStreams({logs:()=>{},status:(s,_m,live)=>status.push([s.key,live])},()=>{const s=new Stream();streams.push(s);return s;});
 manager.sync([phone,web]);streams[0].emit('status',{code:'streamLive'});streams[1].onerror?.();
 assert.equal(streams[0].closed,0);assert.equal(streams[1].closed,1);assert.deepEqual(status.at(-1),[web.key,false]);
 manager.sync([phone,web]);assert.equal(streams.length,2);
 manager.sync([phone]);manager.sync([phone,web]);assert.equal(streams.length,3);manager.close();
});

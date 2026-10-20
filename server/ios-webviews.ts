import type { RuntimeConsole } from './runtime-console.js';
import { randomUUID } from 'node:crypto';
import type { EventEmitter } from 'node:events';
import { acquireInspector } from './ios-inspector.js';
import type { LogMessage, WebView } from '../shared/types.js';
import { notification, type Notification } from '../shared/notifications.js';

// Isolate Appium's pinned transport internals; no HTTP forwards or Safari automation.
export interface Inspector {
  invalidate?(): void;
  _socketClient: EventEmitter & { destroy(): unknown };
  _decoder: EventEmitter & { destroy(): unknown };
  listenMessage(callback: (message: any) => void): void;
  sendMessage(message: any): void;
}
type Connect = (id: string) => Promise<Inspector>;
const connect: Connect = acquireInspector;
const timeoutMs = 5000;
function close(service: Inspector) { service._socketClient.destroy(); service._decoder.destroy(); }
async function acquire(id: string, factory: Connect): Promise<Inspector> {
  return new Promise((resolve, reject) => {
    let expired = false;
    const timer = setTimeout(() => { expired = true; reject(new Error('iOS WebInspector connection timed out')); }, timeoutMs);
    void factory(id).then(service => { clearTimeout(timer); if (expired) close(service); else resolve(service); }, error => { clearTimeout(timer); reject(error); });
  });
}
function send(service: Inspector, connection: string, selector: string, argument: Record<string, unknown> = {}) {
  service.sendMessage({__selector:selector,__argument:{WIRConnectionIdentifierKey:connection,...argument}});
}

export async function discoverIosWebViews(id: string, factory: Connect = connect): Promise<WebView[]> {
  const service = await acquire(id, factory), connection = randomUUID();
  return new Promise((resolve, reject) => {
    const pages = new Map<string, WebView[]>(), pending = new Set<string>();
    let done = false, settle: ReturnType<typeof setTimeout> | undefined;
    let receivedListing = false;
    const deadline = setTimeout(() => finish(receivedListing && !pending.size ? undefined : new Error('iOS WebInspector discovery timed out')), 2500);
    function finish(error?: Error) {
      if (done) return; done = true; clearTimeout(deadline); clearTimeout(settle); if (error) service.invalidate?.(); close(service);
      if (error) reject(error); else resolve([...pages.values()].flat());
    }
    const fail = (error?: Error) => finish(error ?? new Error('iOS WebInspector disconnected'));
    service._socketClient.on('error', fail); service._socketClient.on('close', () => { if (!done) fail(); });
    service._decoder.on('error', fail);
    service.listenMessage(message => {
      if (done) return;
      try {
        const a = message.__argument ?? {};
        if (message.__selector === '_rpc_reportConnectedApplicationList:') {
          receivedListing = true;
          const apps = Object.keys(a.WIRApplicationDictionaryKey ?? {});
          for (const app of apps) pending.add(app);
          for (const app of apps) send(service, connection, '_rpc_forwardGetListing:', {WIRApplicationIdentifierKey:app});
          if (!apps.length) settle = setTimeout(() => finish(), 150);
        } else if (message.__selector === '_rpc_applicationSentListing:') {
          const app = String(a.WIRApplicationIdentifierKey);
          const views = Object.values(a.WIRListingKey ?? {}).flatMap((p: any) => {
            if (p.WIRTypeKey !== 'WIRTypeWebPage' || !Number.isSafeInteger(p.WIRPageIdentifierKey)) return [];
            return [{id:String(p.WIRPageIdentifierKey),socket:app,title:p.WIRTitleKey || '',url:p.WIRURLKey || '',pid:Number(app.replace(/^PID:/,''))}];
          });
          pages.set(app, views); pending.delete(app);
          if (!pending.size) { clearTimeout(settle); settle = setTimeout(() => finish(), 150); }
        }
      } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
    });
    try { send(service, connection, '_rpc_reportIdentifier:'); } catch (error) { fail(error as Error); }
  });
}

export function iosConsoleMessage(message: any, pid?: number): LogMessage {
  const levels: Record<string, string> = {debug:'D',log:'I',info:'I',warning:'W',error:'E'};
  const time = typeof message.timestamp === 'number' ? new Date(message.timestamp * 1000) : new Date();
  const text = typeof message.text === 'string' ? message.text : (message.parameters ?? []).map((p: any) => p.value === undefined ? p.description ?? p.type : typeof p.value === 'string' ? p.value : JSON.stringify(p.value)).join(' ');
  // Ordinary console calls also carry a stack in WebKit; show it only for errors/traces.
  const frames = message.level === 'error' || message.type === 'trace' ? message.stackTrace?.callFrames ?? [] : [];
  const stack = frames.map((f: any) => `    at ${f.functionName || '(anonymous)'} (${f.url || ''}:${f.lineNumber ?? 0}:${f.columnNumber ?? 0})`).join('\n');
  return {timestamp:Number.isNaN(time.getTime()) ? new Date().toISOString() : time.toISOString(),message:text + (stack ? `\n${stack}` : ''),level:levels[message.level] ?? 'I',tag:`console.${message.level || message.type || 'log'}`,pid};
}

export async function openIosWebViewLogs(id: string, view: WebView, onMessage: (message: LogMessage) => void, onEnd: (reason: Notification) => void, factory: Connect = connect, runtime?: RuntimeConsole): Promise<() => void> {
  if (!/^PID:\d+$/.test(view.socket) || !/^\d+$/.test(view.id)) throw new Error('Invalid iOS WebView target');
  const service = await acquire(id, factory), connection = randomUUID(), sender = randomUUID();
  return new Promise((resolve, reject) => {
    let closed = false, ready = false, sequence = 0;
    const wrappers = new Map<number, { id: number; target: string }>();
    const commands = new Map<number, string>(), targets = new Set<string>();
    const timer = setTimeout(() => finish(new Error('iOS WebView console initialization timed out')), timeoutMs);
    function stop() { if (closed) return; closed = true; runtime?.close(); clearTimeout(timer); close(service); }
    function finish(error?: Error) {
      if (closed) return;
      stop();
      if (!ready) reject(error ?? new Error('iOS WebView ended before console initialization'));
      else onEnd(error ? notification('streamError', {platform:'iOS WebView',detail:error.message}) : notification('webviewEnded'));
    }
    function wire(method: string, params: Record<string, unknown>, inner?: { id: number; target: string }) {
      const id = ++sequence;
      if (inner) wrappers.set(id, inner);
      send(service, connection, '_rpc_forwardSocketData:', {WIRApplicationIdentifierKey:view.socket,WIRPageIdentifierKey:Number(view.id),WIRSenderKey:sender,WIRSocketDataKey:Buffer.from(JSON.stringify({id,method,params}))});
    }
    function enable(target: string, main = true) {
      if (targets.has(target)) return; targets.add(target);
      runtime?.attach(target, packet => wire('Target.sendMessageToTarget', { targetId: target, message: JSON.stringify(packet) }, { id: packet.id!, target }), main);
      const command = ++sequence; commands.set(command, target);
      wire('Target.sendMessageToTarget', {targetId:target,message:JSON.stringify({id:command,method:'Console.enable',params:{}})});
    }
    function protocol(data: any, target = '') {
      if (closed) return;
      if (runtime?.receive(data, target)) return;
      const wrapper = !target && wrappers.get(data.id);
      if (wrapper) {
        wrappers.delete(data.id);
        if (data.error) runtime?.receive({ id: wrapper.id, error: data.error }, wrapper.target);
        return;
      }
      if (data.error) { finish(new Error(data.error.message || 'WebInspector command failed')); return; }
      if (commands.has(data.id)) {
        commands.delete(data.id);
        if (!ready) { ready = true; clearTimeout(timer); resolve(stop); }
      }
      if (data.method === 'Target.targetCreated') {
        const target = data.params?.targetInfo;
        if (['page','frame'].includes(target?.type)) enable(target.targetId, target.type === 'page');
      } else if (data.method === 'Target.dispatchMessageFromTarget') {
        if (targets.has(data.params?.targetId)) protocol(JSON.parse(data.params.message), data.params.targetId);
      } else if (data.method === 'Target.targetDestroyed') {
        runtime?.detach(data.params?.targetId);
        targets.delete(data.params?.targetId);
        if (!targets.size) finish();
      } else if (data.method === 'Console.messageAdded' && data.params?.message) {
        onMessage(iosConsoleMessage(data.params.message, view.pid ?? Number(view.socket.slice(4))));
      }
    }
    service._socketClient.on('error', finish); service._socketClient.on('close', () => finish()); service._decoder.on('error', finish);
    service.listenMessage(message => {
      if (closed) return;
      try {
        const a = message.__argument ?? {};
        if (a.WIRApplicationIdentifierKey !== view.socket) return;
        if (message.__selector === '_rpc_applicationSentData:') protocol(JSON.parse(a.WIRMessageDataKey.toString()));
        else if (message.__selector === '_rpc_applicationDisconnected:') finish();
      } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
    });
    try {
      send(service, connection, '_rpc_reportIdentifier:');
      send(service, connection, '_rpc_forwardSocketSetup:', {WIRApplicationIdentifierKey:view.socket,WIRPageIdentifierKey:Number(view.id),WIRSenderKey:sender,WIRAutomaticallyPause:false});
    } catch (error) { finish(error as Error); }
  });
}

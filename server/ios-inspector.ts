import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { services } from 'appium-ios-device';
import type { Inspector } from './ios-webviews.js';

/**
 * Lease one physical WebInspector connection per device to discovery/page consumers.
 * Each facade owns its listeners and sender identity; destroying its socket releases
 * only that lease. The shared transport closes after the last lease and idle delay.
 * Hung opens are evicted and late results destroyed so a later acquisition can retry.
 */
export function createInspectorPool(open: (id: string) => Promise<Inspector>, idleMs = 0, connectTimeoutMs = 5000) {
  const sessions = new Map<string, Promise<Session>>();
  interface Lease { socket: EventEmitter; decoder: EventEmitter; callback?: (message: any) => void; sender?: string; app?: string; page?: number }
  interface Session { service: Inspector; connection: string; leases: Set<Lease>; closed: boolean; idle?: ReturnType<typeof setTimeout>; apps?: Record<string, unknown>; unhealthy?: boolean }
  return async (id: string): Promise<Inspector> => {
    let pending = sessions.get(id);
    if (!pending) {
      const attempt = new Promise<Inspector>((resolve, reject) => {
        let expired = false;
        const timer = setTimeout(() => { expired = true; reject(new Error('iOS WebInspector connection timed out')); }, connectTimeoutMs);
        void open(id).then(service => {
          clearTimeout(timer);
          if (expired) { service._socketClient.destroy(); service._decoder.destroy(); }
          else resolve(service);
        }, error => { clearTimeout(timer); reject(error); });
      });
      pending = attempt.then(service => {
        const session: Session = {service, connection:randomUUID(),leases:new Set(),closed:false};
        const end = (error?: Error) => {
          if (session.closed) return; session.closed = true; clearTimeout(session.idle);
          if (sessions.get(id) === pending) sessions.delete(id);
          for (const lease of [...session.leases]) {
            if (error) lease.socket.emit('error',error);
            lease.socket.emit('close');
          }
          service._socketClient.destroy(); service._decoder.destroy();
        };
        service._socketClient.on('error',end); service._socketClient.on('close',()=>end()); service._decoder.on('error',end);
        service.listenMessage(message => {
          const args = message.__argument ?? {};
          if (message.__selector === '_rpc_reportConnectedApplicationList:') session.apps = {...args.WIRApplicationDictionaryKey};
          if (['_rpc_applicationConnected:', '_rpc_applicationUpdated:'].includes(message.__selector) && session.apps && args.WIRApplicationIdentifierKey) session.apps[args.WIRApplicationIdentifierKey] = args;
          if (message.__selector === '_rpc_applicationDisconnected:' && session.apps) delete session.apps[args.WIRApplicationIdentifierKey];
          const destination = args.WIRDestinationKey;
          for (const lease of [...session.leases]) {
            if (message.__selector === '_rpc_applicationSentData:' && destination && destination !== lease.sender) continue;
            lease.callback?.(message);
          }
        });
        return session;
      }).catch(error => { if(sessions.get(id)===pending) sessions.delete(id); throw error; });
      sessions.set(id,pending);
    }
    const session = await pending;
    if (session.closed) throw new Error('iOS WebInspector disconnected');
    clearTimeout(session.idle);
    const lease: Lease = {socket:new EventEmitter(),decoder:new EventEmitter()};
    session.leases.add(lease);
    const release = () => {
      if (!session.leases.delete(lease)) return;
      if (lease.sender && !session.closed) {
        try { session.service.sendMessage({__selector:'_rpc_forwardDidClose:',__argument:{WIRConnectionIdentifierKey:session.connection,WIRSenderKey:lease.sender,WIRApplicationIdentifierKey:lease.app,WIRPageIdentifierKey:lease.page}}); } catch { /* Transport may already be gone. */ }
      }
      if (!session.leases.size && !session.closed) {
        const expire = () => {
          session.closed = true;
          if (sessions.get(id) === pending) sessions.delete(id);
          session.service._socketClient.destroy(); session.service._decoder.destroy();
        };
        if (idleMs && !session.unhealthy) { session.idle = setTimeout(expire, idleMs); session.idle.unref(); }
        else expire();
      }
    };
    return {
      invalidate() { session.unhealthy = true; },
      _socketClient:Object.assign(lease.socket,{destroy:release}),
      _decoder:Object.assign(lease.decoder,{destroy() {}}),
      listenMessage(callback) { lease.callback=callback; },
      sendMessage(message) {
        if (!session.leases.has(lease) || session.closed) throw new Error('iOS WebInspector disconnected');
        if (message.__selector === '_rpc_reportIdentifier:' && session.apps) {
          queueMicrotask(() => { if (session.leases.has(lease)) lease.callback?.({__selector:'_rpc_reportConnectedApplicationList:',__argument:{WIRApplicationDictionaryKey:session.apps}}); });
          return;
        }
        if (message.__selector==='_rpc_forwardSocketSetup:') { lease.sender=message.__argument.WIRSenderKey; lease.app=message.__argument.WIRApplicationIdentifierKey; lease.page=message.__argument.WIRPageIdentifierKey; }
        session.service.sendMessage({...message,__argument:{...message.__argument,WIRConnectionIdentifierKey:session.connection}});
      },
    };
  };
}
export const acquireInspector = createInspectorPool(async id => await services.startWebInspectorService(id) as Inspector, 10000);

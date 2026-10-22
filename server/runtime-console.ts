import { randomUUID } from 'node:crypto';
import type { ConsoleContext, ConsoleErrorCode, ConsoleResult, ConsoleState, ConsoleValue } from '../shared/console.js';

type Packet = { id?: number; method?: string; params?: any; result?: any; error?: { message?: string } };
type Sender = (packet: Packet) => void;
export class ConsoleError extends Error {
  constructor(public code: ConsoleErrorCode, public protocolMessage?: string) { super(code); }
}
/** Protocol requests never retry: evaluating an expression may have side effects. */
export class RuntimeConsole {
  private sequence = 1_000_000;
  private senders = new Map<string, Sender>();
  private pending = new Map<number, { resolve: (data: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>; target: string }>();
  private contexts = new Map<string, ConsoleContext & { id: number; target: string; uniqueId?: string }>();
  private frames = new Map<string, { name: string; url: string; top: boolean; parent?: string }>();
  private enabled = false;
  private initialized = new Set<string>();
  private pageEnabled = new Set<string>();
  private initializing = new Map<string, Promise<void>>();
  private mainTargets = new Set<string>();
  private busy = false;
  revision = 0;
  constructor(private platform: 'android' | 'ios', private timeout = 8000) {}
  state(): ConsoleState {
    const contexts = [...this.contexts.values()].map(({ id: _id, target: _target, uniqueId: _uniqueId, ...context }) => {
      const frame = this.frames.get(context.frame);
      return { ...context, name: frame?.name || context.name, url: frame?.url || context.url, top: frame?.top ?? context.top };
    });
    // Traverse ancestors too when an intermediate frame has no execution context.
    const path = (id: string): string[] => {
      const ancestors: string[] = [], seen = new Set<string>();
      while (id && !seen.has(id)) {
        seen.add(id); ancestors.unshift(id); id = this.frames.get(id)?.parent || '';
      }
      return ancestors;
    };
    const ordered = contexts.map(context => ({ context, path: path(context.frame) }));
    const frameOrder = new Map([...new Set([...this.frames.keys(), ...contexts.map(c => c.frame)])].map((id, index) => [id, index]));
    ordered.sort((a, b) => {
      if (a.context.top !== b.context.top) return a.context.top ? -1 : 1;
      for (let i = 0; i < Math.min(a.path.length, b.path.length); i++) {
        if (a.path[i] !== b.path[i]) return (frameOrder.get(a.path[i]!) ?? 0) - (frameOrder.get(b.path[i]!) ?? 0);
      }
      return a.path.length - b.path.length;
    });
    return { revision: this.revision, connected: this.senders.size > 0,
      contexts: ordered.map(({ context, path }) => ({ ...context, depth: Math.max(0, path.length - 1) })) };
  }
  attach(target: string, send: Sender, main = true) {
    if (main) this.mainTargets.add(target);
    this.senders.set(target, send);
    if (this.enabled) void this.enableTarget(target);
  }
  detach(target: string) {
    this.senders.delete(target); this.mainTargets.delete(target);
    this.initialized.delete(target); this.pageEnabled.delete(target); this.initializing.delete(target);
    for (const [key, context] of this.contexts) if (context.target === target) this.contexts.delete(key);
    for (const [id, request] of this.pending) if (request.target === target) { clearTimeout(request.timer); request.reject(new ConsoleError('consoleStale')); this.pending.delete(id); }
    this.revision++;
  }
  close() { for (const target of this.senders.keys()) this.detach(target); }
  async enable() {
    this.enabled = true;
    await Promise.all([...this.senders.keys()].map(target => this.enableTarget(target)));
  }
  private enableTarget(target: string): Promise<void> {
    if (this.initialized.has(target)) return Promise.resolve();
    const existing = this.initializing.get(target);
    if (existing) return existing;
    // Reconnect may retry domain setup after failure, but never expression execution.
    let initialization!: Promise<void>;
    initialization = (async () => {
      try {
        // WebKit needs Page enabled before Runtime reports existing frame contexts.
        const domains = this.platform === 'ios' ? ['Page.enable', 'Runtime.enable'] : ['Runtime.enable', 'Page.enable'];
        for (const method of domains) {
          if (method === 'Page.enable' && this.platform === 'ios' && this.pageEnabled.has(target)) continue;
          if (method === 'Page.enable') {
            await this.request(target, method).catch(error => {
              // A lost acknowledgement can leave WebKit enabled before reconnect.
              if (this.platform === 'android' || (error instanceof ConsoleError && error.protocolMessage === 'Page domain already enabled')) return;
              throw error;
            });
          } else await this.request(target, method);
          if (this.initializing.get(target) !== initialization) return;
          if (method === 'Page.enable' && this.platform === 'ios') this.pageEnabled.add(target);
        }
        const data = await this.request(target, this.platform === 'ios' ? 'Page.getResourceTree' : 'Page.getFrameTree').catch(() => ({}));
        if (this.initializing.get(target) !== initialization) return;
        const visit = (tree: any, parent?: string) => {
          if (!tree?.frame) return;
          this.frames.set(String(tree.frame.id), { name: tree.frame.name || '', url: tree.frame.url || '', top: !parent && this.mainTargets.has(target), parent: parent ?? tree.frame.parentId });
          for (const child of tree.childFrames ?? []) visit(child, String(tree.frame.id));
        };
        visit(data.frameTree);
        this.initialized.add(target);
      } catch { /* Unsupported or vanished targets remain unavailable until reconnect. */ }
      finally { if (this.initializing.get(target) === initialization) this.initializing.delete(target); }
    })();
    this.initializing.set(target, initialization);
    return initialization;
  }
  receive(packet: Packet, target = ''): boolean {
    if (packet.id !== undefined && packet.id >= 1_000_000) {
      const request = this.pending.get(packet.id);
      if (request && request.target === target) {
        clearTimeout(request.timer); this.pending.delete(packet.id);
        packet.error ? request.reject(new ConsoleError('consoleUnavailable', packet.error.message)) : request.resolve(packet.result ?? {});
      }
      return true;
    }
    const p = packet.params ?? {};
    if (packet.method === 'Runtime.executionContextCreated') {
      const c = p.context;
      if (!c || c.auxData?.isDefault === false || c.isPageContext === false || (this.platform === 'ios' && c.type && c.type !== 'normal')) return false;
      if (![...this.contexts.values()].some(item => item.target === target && item.id === c.id)) {
        if (this.platform === 'ios') {
          for (const [oldKey, old] of this.contexts) if (old.target === target && old.frame === String(c.frameId)) { this.contexts.delete(oldKey); this.revision++; }
        }
        const key = randomUUID();
        this.contexts.set(key, { key, id: c.id, uniqueId: c.uniqueId, target, frame: String(c.auxData?.frameId ?? c.frameId ?? ''), name: c.name || '', url: c.origin || '', top: false });
      }
    } else if (packet.method === 'Runtime.executionContextsCleared' || packet.method === 'Runtime.executionContextDestroyed') {
      for (const [key, context] of this.contexts) if (context.target === target && (packet.method.endsWith('Cleared') || context.id === p.executionContextId)) this.contexts.delete(key);
      this.revision++;
    } else if (packet.method === 'Page.frameDetached') {
      for (const [key, context] of this.contexts) if (context.frame === String(p.frameId)) this.contexts.delete(key);
      this.frames.delete(String(p.frameId)); this.revision++;
    } else if (packet.method === 'Page.frameNavigated') {
      // Frame navigation invalidates approval even when a backend reuses context IDs.
      this.revision++;
      const f = p.frame;
      if (f && this.platform === 'ios') for (const [key, context] of this.contexts) if (context.target === target && (!f.parentId || context.frame === String(f.id))) this.contexts.delete(key);
      if (f) this.frames.set(String(f.id), { name: f.name || '', url: f.url || '', top: !f.parentId && this.mainTargets.has(target), parent: f.parentId });
    }
    return false;
  }
  private request(target: string, method: string, params: Record<string, unknown> = {}): Promise<any> {
    const send = this.senders.get(target);
    if (!send) return Promise.reject(new ConsoleError('consoleUnavailable'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new ConsoleError('consoleTimeout')); }, this.timeout);
      this.pending.set(id, { resolve, reject, timer, target });
      try { send({ id, method, params }); } catch { clearTimeout(timer); this.pending.delete(id); reject(new ConsoleError('consoleUnavailable')); }
    });
  }
  async evaluate(key: string, revision: number, expression: string): Promise<ConsoleResult> {
    if (this.busy) throw new ConsoleError('consoleBusy');
    const context = this.contexts.get(key);
    if (!context || revision !== this.revision) throw new ConsoleError('consoleStale');
    if (typeof expression !== 'string' || !expression.trim() || expression.length > 16384) throw new ConsoleError('consoleInvalid');
    this.busy = true;
    const start = Date.now(), group = randomUUID();
    let remaining = 150, characters = 65536;
    const snapshot = async (object: any, depth: number, seen: Set<string>): Promise<ConsoleValue> => {
      const text = String(object?.unserializableValue ?? object?.description ?? (Object.hasOwn(object ?? {}, 'value') ? JSON.stringify(object.value) : object?.type ?? 'undefined'));
      const limit = Math.min(16000, characters); characters -= Math.min(limit, text.length);
      const value: ConsoleValue = { type: object?.subtype || object?.type || 'undefined', text: text.slice(0, limit), ...(text.length > limit ? { truncated: true } : {}) };
      if (!object?.objectId || object.type === 'function') return value;
      if (depth >= 3 || remaining <= 0 || characters <= 0 || Date.now() - start > 4000 || seen.has(object.objectId)) return { ...value, truncated: true };
      const nextSeen = new Set(seen).add(object.objectId);
      const properties = await this.request(context.target, 'Runtime.getProperties', { objectId: object.objectId, ownProperties: true, generatePreview: false, ...(this.platform === 'ios' ? { fetchCount: 51 } : {}) }).catch(() => null);
      if (!properties) return { ...value, truncated: true };
      const list = (properties.result ?? properties.properties ?? []).filter((p: any) => p.isOwn !== false && p.name !== '__proto__');
      value.children = [];
      for (const property of list.slice(0, 50)) {
        if (remaining <= 0 || characters <= 0) break;
        remaining--;
        const name = String(property.name).slice(0, Math.min(2048, characters)); characters -= name.length;
        value.children.push({ name, value: property.value ? await snapshot(property.value, depth + 1, nextSeen) : { type: 'accessor', text: 'get/set' } });
      }
      if (list.length > value.children.length) value.truncated = true;
      return value;
    };
    try {
      const data = await this.request(context.target, 'Runtime.evaluate', { expression, ...(context.uniqueId && this.platform === 'android' ? { uniqueContextId: context.uniqueId } : { contextId: context.id }), objectGroup: group, returnByValue: false, ...(this.platform === 'android' ? { generatePreview: false } : {}) });
      if (revision !== this.revision || !this.contexts.has(key)) throw new ConsoleError('consoleStale');
      const value = await snapshot(data.exceptionDetails?.exception ?? data.result, 0, new Set());
      if (revision !== this.revision) throw new ConsoleError('consoleStale');
      return { value, exception: !!(data.wasThrown || data.exceptionDetails), elapsed: Date.now() - start, revision };
    } finally {
      // Release temporary remote handles without retaining results in the inspected app.
      void this.request(context.target, 'Runtime.releaseObjectGroup', { objectGroup: group }).catch(() => {});
      this.busy = false;
    }
  }
}

import { randomUUID } from 'node:crypto';
import type { ConsoleState } from '../shared/console.js';
import type { MessageCapture, MessageRecord } from '../shared/postmessage.js';

// Run in the page's own world. No messages are sent and no postMessage methods are replaced.
function install(name: string) {
  const w = window as any;
  if (w[name]) return false;
  const queue: { time: number; sourceWindow: Window | null; origin: string; data: string }[] = [];
  let dropped = 0, expires = Date.now() + 30000;
  const path = (target: Window | null): string | null => {
    if (!target) return null;
    let budget = 256;
    const visit = (node: Window, location: string, depth: number): string | null => {
      if (--budget < 0 || depth > 16) return null;
      if (node === target) return location;
      try { for (let i = 0; i < node.frames.length && budget > 0; i++) { const found = visit(node.frames[i]!, `${location}/${i}`, depth + 1); if (found !== null) return found; } } catch { /* Inaccessible window remains unidentified. */ }
      return null;
    };
    return visit(window.top!, 'top', 0);
  };
  const preview = (input: unknown): string => {
    let budget = 200, chars = 8000;
    const seen = new Set<object>();
    const walk = (value: any, depth: number): any => {
      if (--budget < 0 || chars <= 0) return '[…]';
      if (typeof value === 'string') { const s = value.slice(0, Math.min(chars, 2000)); chars -= s.length; return s.length < value.length ? `${s}…` : s; }
      if (typeof value === 'number' && (!Number.isFinite(value) || Object.is(value, -0))) return `[Number: ${Object.is(value, -0) ? '-0' : String(value)}]`;
      if (typeof value === 'bigint') return `[BigInt: ${String(value)}]`;
      if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
      if (typeof value !== 'object') return String(value);
      if (seen.has(value)) return '[Circular]';
      if (depth >= 4) return '[…]';
      seen.add(value);
      if (Array.isArray(value)) {
        const out: unknown[] = [];
        for (let i = 0; i < Math.min(value.length, 50) && budget > 0 && chars > 0; i++) {
          const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
          out.push(descriptor && 'value' in descriptor ? walk(descriptor.value, depth + 1) : '[Empty/Accessor]');
        }
        if (out.length < value.length) out.push('[…]');
        return out;
      }
      const prototype = Object.getPrototypeOf(value);
      const constructor = prototype && Object.getOwnPropertyDescriptor(prototype, 'constructor')?.value;
      const type = constructor && Object.getOwnPropertyDescriptor(constructor, 'name')?.value;
      if (type && type !== 'Object') return `[${String(type).slice(0, 80)}: preview unavailable]`;
      const out: Record<string, unknown> = Object.create(null);
      // Enumerate at most 50 own enumerable properties, without invoking getters or toJSON.
      let count = 0;
      for (const key in value) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
        if (count++ >= 50 || budget <= 0 || chars <= 0) { out['…'] = '[…]'; break; }
        const property = Object.getOwnPropertyDescriptor(value, key);
        const label = key.slice(0, 200); chars -= label.length;
        out[label] = property && 'value' in property ? walk(property.value, depth + 1) : '[Accessor]';
      }
      return out;
    };
    try { return JSON.stringify(walk(input, 0)).slice(0, 12000); } catch { return '[Unavailable]'; }
  };
  const listener = (event: MessageEvent) => {
    if (!event.isTrusted) return;
    if (Date.now() > expires) { stop(); return; }
    if (queue.length >= 200) { queue.shift(); dropped++; }
    queue.push({ time: Date.now(), sourceWindow: event.source as Window | null, origin: event.origin.slice(0, 2048), data: preview(event.data) });
  };
  const stop = () => { removeEventListener('message', listener, true); clearInterval(timer); delete w[name]; };
  const timer = setInterval(() => { if (Date.now() > expires) stop(); }, 5000);
  Object.defineProperty(w, name, { configurable: true, value: {
    stop,
    read: (final = false) => { expires = Date.now() + 30000; const result = { path: path(window), records: queue.splice(0).map(({ sourceWindow, ...record }) => ({ ...record, sourcePath: path(sourceWindow) })), dropped }; dropped = 0; if (final) stop(); return result; },
  } });
  addEventListener('message', listener, true);
  return true;
}

export class MessageMonitor {
  private name = `__udl_messages_${randomUUID().replaceAll('-', '')}`;
  private active = false;
  private revision = -1;
  private contexts: string[] = [];
  private unavailable: string[] = [];
  private sequence = 0;
  private epoch = 0;
  private busy = false;
  constructor(private state: () => ConsoleState, private evaluate: (key: string, revision: number, expression: string) => Promise<any>) {}
  async start(revision: number) {
    if (this.busy) throw new Error('busy');
    if (revision !== this.state().revision) throw new Error('stale');
    this.busy = true;
    try {
      await this.stop();
      const epoch = this.epoch;
      this.revision = revision;
      const keys = this.state().contexts.map(c => c.key);
      this.unavailable = keys.slice(64);
      this.contexts = keys.slice(0, 64);
      await Promise.all(this.contexts.map(async key => {
        try { if (await this.evaluate(key, revision, `(() => { const __name = value => value; return (${install.toString()})(${JSON.stringify(this.name)}); })()`) !== true) this.unavailable.push(key); }
        catch { this.unavailable.push(key); }
      }));
      if (epoch !== this.epoch || revision !== this.state().revision) { await this.stop(); return this.snapshot(); }
      this.active = this.contexts.some(k => !this.unavailable.includes(k));
      return this.snapshot();
    } finally { this.busy = false; }
  }
  private snapshot(records: MessageRecord[] = [], dropped = 0): MessageCapture {
    return { active: this.active, revision: this.revision, contexts: this.contexts.filter(k => !this.unavailable.includes(k)), unavailable: [...this.unavailable], records, dropped };
  }
  async poll(final = false): Promise<MessageCapture> {
    if (this.busy) return this.snapshot();
    if (!this.active) return this.snapshot();
    if (this.revision !== this.state().revision) { await this.stop(); return this.snapshot(); }
    this.busy = true;
    const epoch = this.epoch;
    try {
      const pages: { key: string; data: any }[] = [];
      await Promise.all(this.contexts.filter(k => !this.unavailable.includes(k)).map(async key => {
        try {
          const data = await this.evaluate(key, this.revision, `window[${JSON.stringify(this.name)}]?.read(${final})`);
          if (!data || !Array.isArray(data.records)) throw new Error('expired');
          pages.push({ key, data });
        } catch { this.unavailable.push(key); }
      }));
      if (epoch !== this.epoch || this.revision !== this.state().revision) { await this.stop(); return this.snapshot(); }
      this.active = pages.length > 0;
      const paths = new Map<string, string>();
      for (const { key, data } of pages) if (typeof data.path === 'string') paths.set(data.path, key);
      const records: MessageRecord[] = [];
      let dropped = 0;
      for (const { key, data } of pages) {
        dropped += Number.isSafeInteger(data.dropped) && data.dropped > 0 ? data.dropped : 0;
        for (const row of data.records.slice(0, 200)) {
          if (typeof row.data !== 'string' || typeof row.origin !== 'string' || !Number.isFinite(row.time)) continue;
          records.push({ id: ++this.sequence, time: row.time, receiver: key, source: paths.get(row.sourcePath) ?? null, origin: row.origin.slice(0, 2048), data: row.data.slice(0, 12000) });
        }
      }
      records.sort((a, b) => a.time - b.time || a.id - b.id);
      // Bound each response as well as per-frame queues.
      dropped += Math.max(0, records.length - 500);
      return this.snapshot(records.slice(-500), dropped);
    } finally { this.busy = false; }
  }
  async finish(): Promise<MessageCapture> {
    if (this.busy) throw new Error('busy');
    const result = await this.poll(true);
    await this.stop();
    return { ...result, active: false };
  }
  async stop() {
    this.epoch++; this.active = false;
    const keys = this.contexts; this.contexts = [];
    await Promise.allSettled(keys.map(key => this.evaluate(key, this.state().revision, `window[${JSON.stringify(this.name)}]?.stop()`)));
  }
}

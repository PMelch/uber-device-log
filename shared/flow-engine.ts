import type { FlowBlueprint, FlowEngineState, FlowInstance, FlowMatcher, FlowExtractor, FlowObservation, FlowStep, FlowError } from './flow-types.js';
import type { LogMessage } from './types.js';

/** Pure, session-local recognition. A worker owns the clock, queues and lifecycle. */
export function createFlowEngine(now: () => number = () => performance.now()) {
  let blueprints: FlowBlueprint[] = [], revision = '', epoch = 0, serial = 0, gaps = 0, stateVersion = 0;
  let instances: FlowInstance[] = [];
  type BlueprintScope = { id: string; revisions: string[] };
  let pending: { message: LogMessage; at: number; scopes: BlueprintScope[] }[] = [];
  const sizes = new Map<string, number>();
  const regexes = new Map<string, RegExp>();
  const reorderMs = 2000, budget = 32 * 1024 * 1024;
  function expression(pattern: string) {
    let regex = regexes.get(pattern);
    if (!regex) { regex = new RegExp(pattern); if (regexes.size < 1000) regexes.set(pattern, regex); }
    regex.lastIndex = 0;
    return regex;
  }
  function valueAt(body: unknown, path: string): unknown {
    let value = body;
    for (const name of path.split('.')) {
      if (!value || typeof value !== 'object' || ['__proto__', 'prototype', 'constructor'].includes(name) || !Object.hasOwn(value, name)) return undefined;
      value = (value as Record<string, unknown>)[name];
    }
    return value;
  }
  const scalar = (value: unknown): value is string | number | boolean => ['string', 'number', 'boolean'].includes(typeof value) && (typeof value !== 'number' || Number.isFinite(value));
  function references(matcher: FlowMatcher): boolean { return !!matcher.json?.equalsFrom || !!matcher.all?.some(references); }
  function matches(matcher: FlowMatcher, message: LogMessage, body: unknown, instance?: FlowInstance, ignoreReferences = false): boolean {
    if (matcher.source === 'device' && message.source?.webview || matcher.source === 'webview' && !message.source?.webview) return false;
    if (matcher.platform && matcher.platform !== message.source?.platform || matcher.tag !== undefined && matcher.tag !== message.tag || matcher.level !== undefined && matcher.level !== message.level) return false;
    if (matcher.contains !== undefined && !message.message.includes(matcher.contains)) return false;
    if (matcher.regex !== undefined && !expression(matcher.regex).test(message.message)) return false;
    if (matcher.json) {
      const actual = valueAt(body, matcher.json.path);
      if (actual === undefined) return false;
      if (matcher.json.equalsFrom) {
        const ref = matcher.json.equalsFrom;
        const previous = instance?.observations.find(row => row.stepId === ref.step && row.accepted !== false)?.payload[ref.field];
        if (ignoreReferences ? !scalar(actual) : !scalar(previous) || actual !== previous) return false;
      } else if (actual !== matcher.json.equals) return false;
    }
    return !matcher.all || matcher.all.every(child => matches(child, message, body, instance, ignoreReferences));
  }
  function extract(fields: Record<string, FlowExtractor> | undefined, message: LogMessage, body: unknown) {
    const payload: Record<string, unknown> = Object.create(null);
    for (const [field, spec] of Object.entries(fields ?? {})) {
      const value = spec.json !== undefined ? valueAt(body, spec.json) : expression(spec.regex!).exec(message.message)?.groups?.[spec.group!];
      if (value === undefined) { if (spec.required) return; }
      else payload[field] = value;
    }
    return payload;
  }
  function keys(blueprint: FlowBlueprint) { return [blueprint.correlation.primary, ...(blueprint.correlation.aliases ?? [])]; }
  function identity(instance: FlowInstance, payload: Record<string, unknown>, matcher: FlowMatcher) {
    let found = false;
    for (const key of keys(instance.blueprint)) {
      const value = payload[key];
      if (value === undefined || instance.bindings[key] === undefined) continue;
      if (instance.bindings[key] !== value) return false;
      found = true;
    }
    return found || references(matcher);
  }
  function parseBody(message: LogMessage) { try { return JSON.parse(message.message); } catch { return undefined; } }
  function active(instance: FlowInstance) { return instance.epoch === epoch && (instance.outcome === 'running' || instance.outcome === 'timed_out'); }
  function definitions() {
    const values = new Map<string, { blueprint: FlowBlueprint; revision: string }>();
    for (const blueprint of blueprints) values.set(`${revision}:${blueprint.id}`, { blueprint, revision });
    for (const instance of instances.filter(active)) values.set(`${instance.revision}:${instance.blueprint.id}`, { blueprint: instance.blueprint, revision: instance.revision });
    return [...values.values()];
  }
  function annotate(matcher: FlowMatcher, payload: Record<string, unknown>, blueprint: FlowBlueprint, instance: FlowInstance): string[] {
    const comparisons: string[] = [];
    function visit(m: FlowMatcher) {
      if (m.json?.equalsFrom) { const r = m.json.equalsFrom; comparisons.push(`${m.json.path} == ${r.step}.${r.field} (${JSON.stringify(instance.observations.find(o => o.stepId === r.step && o.accepted !== false)?.payload[r.field])})`); }
      m.all?.forEach(visit);
    }
    visit(matcher);
    for (const key of keys(blueprint)) if (payload[key] !== undefined && instance.bindings[key] === payload[key]) comparisons.push(`${key} == ${JSON.stringify(payload[key])}`);
    return comparisons;
  }
  function observation(instance: FlowInstance, node: FlowStep | FlowError, message: LogMessage, payload: Record<string, unknown>, at: number): FlowObservation {
    return { stepId: node.id, message: structuredClone(message), receivedAt: at, payload: structuredClone(payload), matchedBy: annotate(node.match, payload, instance.blueprint, instance) };
  }
  function trim() {
    function memory() {
      const definitions = new Set([...blueprints, ...instances.map(instance => instance.blueprint)]);
      return [...sizes.values()].reduce((sum, n) => sum + n, 0) + [...definitions].reduce((sum, blueprint) => sum + JSON.stringify(blueprint).length * 2, 0) + pending.reduce((sum, row) => sum + row.message.message.length * 2, 0);
    }
    while (instances.length && (instances.length > 2500 || memory() > budget)) {
      stateVersion++;
      const index = instances.findIndex(i => i.outcome !== 'running');
      const [removed] = instances.splice(index < 0 ? 0 : index, 1);
      sizes.delete(removed.id);
      if (removed.outcome === 'running') gaps++;
    }
    const running = instances.filter(i => i.outcome === 'running');
    for (const instance of running.slice(0, Math.max(0, running.length - 500))) { instance.outcome = 'interrupted'; instance.endedAt = now(); instance.completeness = 'capture_gap'; gaps++; }
    const terminal = instances.filter(i => i.outcome !== 'running');
    const evict = new Set(terminal.slice(0, Math.max(0, terminal.length - 2000)).map(i => i.id));
    instances = instances.filter(i => { if (!evict.has(i.id)) return true; sizes.delete(i.id); return false; });
  }
  function commit(instance: FlowInstance, node: FlowStep | FlowError, message: LogMessage, payload: Record<string, unknown>, at: number) {
    const obs = observation(instance, node, message, payload, at);
    if (message.truncated) instance.completeness = 'capture_gap';
    for (const key of keys(instance.blueprint)) if (scalar(payload[key])) instance.bindings[key] = payload[key];
    instance.observations.push(obs);
    instance.updatedAt = at;
    const isError = 'codeField' in node;
    let outcome: FlowInstance['outcome'] | undefined;
    if (isError) {
      const code = payload[node.codeField];
      instance.errorCode = code === undefined ? undefined : String(code);
      const known = Object.hasOwn(node.codes, String(code)) ? node.codes[String(code)] : undefined;
      instance.errorDescription = known?.description;
      obs.errorCode = instance.errorCode;
      obs.errorDescription = known?.description;
      outcome = known?.outcome ?? node.unknownOutcome;
      instance.expected = [];
    } else {
      instance.expected = node.next ?? [];
      outcome = node.outcome;
    }
    if (outcome) {
      if (instance.outcome === 'timed_out') instance.lateOutcome = outcome;
      else {
        instance.outcome = outcome === 'completed' && instance.completeness === 'missing_start' ? 'interrupted' : outcome;
        instance.endedAt = at;
      }
    }
    sizes.set(instance.id, (sizes.get(instance.id) ?? 0) + JSON.stringify(obs).length * 2);
    trim();
  }
  function create(blueprint: FlowBlueprint, rev: string, message: LogMessage, node: FlowStep, payload: Record<string, unknown>, at: number, orphan: boolean) {
    const duration = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(blueprint.timeout)!;
    const timeout = Number(duration[1]) * ({ ms: 1, s: 1000, m: 60000, h: 3600000 }[duration[2] as 'ms' | 's' | 'm' | 'h']);
    const instance: FlowInstance = { id: `${blueprint.id}-${++serial}`, epoch, blueprint, revision: rev, deviceId: message.source?.deviceId ?? '', outcome: 'running', completeness: orphan ? 'missing_start' : 'complete', startedAt: at, updatedAt: at, timeoutAt: at + timeout, observations: [], expected: [node.id], bindings: Object.create(null) };
    instances.push(instance);
    commit(instance, node, message, payload, at);
  }
  function process(message: LogMessage, at: number, allowOrphan: boolean, scopes?: BlueprintScope[]): Set<string> {
    const body = parseBody(message), deviceId = message.source?.deviceId ?? '';
    // Pending evidence keeps only the definitions/revisions that saw it originally.
    const eligible = definitions().filter(item => !scopes || scopes.some(scope => scope.id === item.blueprint.id && scope.revisions.includes(item.revision)));
    const groups = new Map<string, { blueprint: FlowBlueprint; revision: string }[]>();
    for (const item of eligible) { const group = groups.get(item.blueprint.id) ?? []; group.push(item); groups.set(item.blueprint.id, group); }
    const consumed = new Set<string>();
    for (const variants of groups.values()) {
      type Candidate = { instance: FlowInstance; node: FlowStep | FlowError; payload: Record<string, unknown> };
      let candidates: Candidate[] = [];
      const existingAll = instances.filter(i => active(i) && i.deviceId === deviceId && i.blueprint.id === variants[0].blueprint.id && variants.some(item => item.revision === i.revision));
      for (const instance of existingAll) {
        const errors = (instance.blueprint.errors ?? []).filter(rule => rule.appliesTo === 'active' || rule.appliesTo.some(id => instance.expected.includes(id) || instance.observations.at(-1)?.stepId === id));
        for (const node of errors) {
          if (!matches(node.match, message, body, instance)) continue;
          const payload = extract(node.extract, message, body);
          if (payload && identity(instance, payload, node.match)) candidates.push({ instance, node, payload });
        }
      }
      if (!candidates.length) for (const instance of existingAll) {
        for (const node of instance.blueprint.steps.filter(step => instance.expected.includes(step.id))) {
          if (!matches(node.match, message, body, instance)) continue;
          const payload = extract(node.extract, message, body);
          if (payload && identity(instance, payload, node.match)) candidates.push({ instance, node, payload });
        }
      }
      if (candidates.length > 1) {
        candidates.forEach(candidate => candidate.instance.completeness = 'ambiguous');
        consumed.add(variants[0].blueprint.id); continue;
      }
      if (candidates.length === 1) {
        const { instance, node, payload } = candidates[0];
        if (instance.completeness === 'ambiguous') { consumed.add(variants[0].blueprint.id); continue; }
        const collisions = existingAll.filter(other => other !== instance && keys(instance.blueprint).some(key => scalar(payload[key]) && other.bindings[key] === payload[key]));
        if (collisions.length) { instance.completeness = 'ambiguous'; collisions.forEach(other => other.completeness = 'ambiguous'); }
        else commit(instance, node, message, payload, at);
        consumed.add(variants[0].blueprint.id); continue;
      }
      const current = variants.find(item => item.revision === revision && blueprints.some(b => b.id === item.blueprint.id));
      if (!current) continue;
      const { blueprint, revision: rev } = current;
      const node = blueprint.steps.find(step => step.id === blueprint.start)!;
      if (matches(node.match, message, body)) {
        const payload = extract(node.extract, message, body);
        if (payload && scalar(payload[blueprint.correlation.primary])) {
          const conflict = existingAll.filter(i => i.revision === rev && i.bindings[blueprint.correlation.primary] === payload[blueprint.correlation.primary]);
          if (conflict.length) conflict.forEach(i => i.completeness = 'ambiguous');
          else create(blueprint, rev, message, node, payload, at, false);
          consumed.add(variants[0].blueprint.id);
        }
      } else if (allowOrphan) {
        const possibilities = blueprint.steps.filter(step => step.id !== blueprint.start && !references(step.match)).flatMap(step => {
          if (!matches(step.match, message, body)) return [];
          const payload = extract(step.extract, message, body);
          if (!payload || !keys(blueprint).some(key => scalar(payload[key]))) return [];
          return [{ step, payload }];
        });
        if (possibilities.length === 1) {
          const { step, payload } = possibilities[0];
          const related = existingAll.filter(i => identity(i, payload, step.match));
          if (related.length) for (const instance of related) {
            // Retain the evidence, but never publish extractions from an ineligible step.
            if (!instance.observations.some(o => o.stepId === step.id && o.accepted !== false)) {
              if (instance.completeness === 'complete') instance.completeness = 'missing_steps';
              const obs = { ...observation(instance, step, message, payload, at), accepted: false };
              instance.observations.push(obs);
              sizes.set(instance.id, (sizes.get(instance.id) ?? 0) + JSON.stringify(obs).length * 2);
            }
          } else create(blueprint, rev, message, step, payload, at, true);
          consumed.add(variants[0].blueprint.id);
        }
      }
    }
    if (consumed.size) stateVersion++;
    return consumed;
  }
  function relevantScopes(message: LogMessage): BlueprintScope[] {
    const body = parseBody(message), scopes = new Map<string, BlueprintScope>();
    for (const item of definitions()) {
      if (![...item.blueprint.steps, ...(item.blueprint.errors ?? [])].some(node => matches(node.match, message, body, undefined, true))) continue;
      const scope = scopes.get(item.blueprint.id) ?? { id: item.blueprint.id, revisions: [] };
      scope.revisions.push(item.revision);
      scopes.set(scope.id, scope);
    }
    return [...scopes.values()];
  }
  function retry() {
    let progress = true, passes = 0;
    while (progress && pending.length && passes++ < 100) {
      progress = false;
      pending = pending.filter(row => {
        const consumed = process(row.message, row.at, false, row.scopes);
        if (consumed.size) progress = true;
        row.scopes = row.scopes.filter(scope => !consumed.has(scope.id));
        return row.scopes.length > 0;
      });
    }
  }
  return {
    setBlueprints(next: FlowBlueprint[], rev: string) { if (JSON.stringify(next).length * 2 > budget / 2) throw new Error('Blueprint snapshot exceeds analysis budget.'); blueprints = structuredClone(next); revision = rev; stateVersion++; trim(); },
    ingest(messages: LogMessage[]) {
      const at = now();
      for (const message of messages) {
        const scopes = relevantScopes(message);
        const consumed = process(message, at, false);
        const unresolved = scopes.filter(scope => !consumed.has(scope.id));
        // One log can complete one blueprint while still waiting on another graph.
        if (unresolved.length) pending.push({ message: structuredClone(message), at, scopes: unresolved });
      }
      let pendingBytes = pending.reduce((sum, row) => sum + row.message.message.length * 2, 0);
      let dropped = false;
      while (pending.length > 1000 || pendingBytes > 2 * 1024 * 1024) { pendingBytes -= pending.shift()!.message.message.length * 2; dropped = true; }
      if (dropped) { stateVersion++; gaps++; for (const instance of instances.filter(active)) instance.completeness = 'capture_gap'; }
      retry();
    },
    tick() {
      retry();
      const expired = pending.filter(row => now() - row.at > reorderMs);
      pending = pending.filter(row => now() - row.at <= reorderMs);
      for (const row of expired) process(row.message, row.at, true, row.scopes);
      for (const instance of instances) if (instance.outcome === 'running' && now() >= instance.timeoutAt) { instance.outcome = 'timed_out'; instance.endedAt = instance.timeoutAt; stateVersion++; }
      trim();
    },
    gap() { stateVersion++; gaps++; for (const instance of instances.filter(active)) instance.completeness = 'capture_gap'; },
    interrupt() { stateVersion++; for (const instance of instances.filter(active)) if (instance.outcome === 'running') { instance.outcome = 'interrupted'; instance.endedAt = now(); } pending = []; epoch++; },
    clear() { stateVersion++; instances = []; pending = []; sizes.clear(); gaps = 0; epoch++; },
    getVersion() { return stateVersion; },
    getState(): FlowEngineState { return structuredClone({ instances, gaps }); },
  };
}

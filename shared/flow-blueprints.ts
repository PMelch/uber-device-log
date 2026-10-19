import { parseDocument, LineCounter, isAlias, isCollection, isPair } from 'yaml';
import type { FlowBlueprint, FlowDiagnostic } from './flow-types.js';
export const FLOW_FILE_LIMIT = 256 * 1024;
export function flowDiagnostic(detail: string, file?: string, path?: string): FlowDiagnostic {
  return { code: 'flowsDiagnostic', params: { detail }, message: detail, ...(file ? { file } : {}), ...(path ? { path } : {}) };
}
export function parseFlowBlueprint(source: string, filename?: string): { blueprint?: FlowBlueprint; diagnostics: FlowDiagnostic[] } {
  const diagnostics: FlowDiagnostic[] = [];
  const fail = (detail: string, path?: string) => diagnostics.push(flowDiagnostic(detail, filename, path));
  if (source.length > FLOW_FILE_LIMIT) return { diagnostics: [flowDiagnostic('Blueprint exceeds 256 KiB.', filename)] };
  const lines = new LineCounter();
  let value: unknown;
  try {
    const doc = parseDocument(source, { schema: 'core', uniqueKeys: true, lineCounter: lines });
    for (const issue of [...doc.errors, ...doc.warnings]) {
      const location = lines.linePos(issue.pos[0]);
      diagnostics.push({ ...flowDiagnostic(issue.message, filename), ...location });
    }
    let nodes = 0;
    const visit = (node: unknown, depth = 0): void => {
      if (++nodes > 12000 || depth > 32) throw new Error('YAML exceeds node/depth limits.');
      if (isAlias(node)) throw new Error('YAML aliases are not supported.');
      if (isCollection(node)) for (const item of node.items) visit(item, depth + 1);
      else if (isPair(node)) { visit(node.key, depth + 1); visit(node.value, depth + 1); }
    };
    visit(doc.contents);
    if (!diagnostics.length) value = doc.toJS({ maxAliasCount: 0 });
  } catch (error) { fail(error instanceof Error ? error.message : String(error)); }
  if (diagnostics.length) return { diagnostics };
  type Obj = Record<string, any>;
  const obj = (v: unknown, allowed: string[], path: string): v is Obj => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) { fail('Expected an object.', path); return false; }
    for (const key of Object.keys(v)) if (!allowed.includes(key)) fail(`Unknown field: ${key}`, `${path}.${key}`);
    return true;
  };
  const str = (v: unknown, path: string) => { if (typeof v !== 'string' || !v.trim() || v.length > 4096) fail('Expected a non-empty string (maximum 4096 characters).', path); };
  const field = (v: unknown, path: string) => {
    str(v, path);
    if (typeof v === 'string' && (!/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(v) || v.split('.').some(k => ['__proto__', 'prototype', 'constructor'].includes(k)))) fail('Expected a safe dot-separated property path.', path);
  };
  const regex = (v: unknown, path: string) => { str(v, path); try { if (typeof v === 'string') new RegExp(v); } catch { fail('Invalid regular expression.', path); } };
  const references: { consumer: string; producer: string; field: string; path: string }[] = [];
  const match = (v: unknown, path: string, consumer: string, depth = 0): void => {
    if (depth > 12) { fail('Matcher nesting exceeds 12.', path); return; }
    if (!obj(v, ['source','platform','tag','level','contains','regex','json','all'], path)) return;
    if (v.source !== undefined && !['any','device','webview'].includes(v.source)) fail('Invalid source.', path);
    if (v.platform !== undefined && !['ios','android'].includes(v.platform)) fail('Invalid platform.', path);
    for (const key of ['tag','level','contains']) if (v[key] !== undefined) str(v[key], `${path}.${key}`);
    if (v.regex !== undefined) regex(v.regex, `${path}.regex`);
    if (v.all !== undefined) {
      if (!Array.isArray(v.all) || !v.all.length || v.all.length > 20) fail('all requires 1–20 predicates.', path);
      else v.all.forEach((m: unknown, i: number) => match(m, `${path}.all.${i}`, consumer, depth + 1));
    }
    if (v.json !== undefined && obj(v.json, ['path','equals','equalsFrom'], `${path}.json`)) {
      field(v.json.path, `${path}.json.path`);
      if (Object.hasOwn(v.json,'equals') === Object.hasOwn(v.json,'equalsFrom')) fail('Specify exactly one of equals and equalsFrom.', path);
      if (Object.hasOwn(v.json, 'equals') && v.json.equals !== null && !['string','number','boolean'].includes(typeof v.json.equals)) fail('equals must be a scalar.', path);
      if (v.json.equalsFrom !== undefined && obj(v.json.equalsFrom, ['step','field'], `${path}.json.equalsFrom`)) {
        str(v.json.equalsFrom.step, path); field(v.json.equalsFrom.field, path);
        references.push({ consumer, producer: v.json.equalsFrom.step, field: v.json.equalsFrom.field, path });
      }
    }
    if (v.contains === undefined && v.regex === undefined && v.json === undefined && v.all === undefined) fail('Matcher needs contains, regex, json or all.', path);
  };
  const extract = (v: unknown, path: string): void => {
    if (v === undefined) return;
    if (!obj(v, Object.keys(v ?? {}), path)) return;
    if (Object.keys(v).length > 50) fail('At most 50 extraction fields are allowed.', path);
    for (const [key, item] of Object.entries(v)) {
      field(key, path);
      if (!obj(item, ['json','regex','group','required','sensitive'], `${path}.${key}`)) continue;
      if ((item.json !== undefined) === (item.regex !== undefined)) fail('Extractor requires exactly one of json or regex.', path);
      if (item.json !== undefined) { field(item.json, path); if (item.group !== undefined) fail('group only applies to regex extractors.', path); }
      if (item.regex !== undefined) {
        regex(item.regex, path); str(item.group, path);
        if (typeof item.regex === 'string' && typeof item.group === 'string' && ![...item.regex.matchAll(/\(\?<([A-Za-z_$][\w$]*)>/g)].some(m => m[1] === item.group)) fail('Regex extractor group must name an existing capture group.', path);
      }
      for (const flag of ['required','sensitive']) if (item[flag] !== undefined && typeof item[flag] !== 'boolean') fail(`${flag} must be boolean.`, path);
    }
  };
  if (!obj(value, ['version','id','name','description','start','timeout','correlation','steps','errors'], '$')) return { diagnostics };
  const b = value;
  if (b.version !== 1) fail('Only version 1 is supported.', 'version');
  for (const k of ['id','name','start','timeout']) str(b[k], k);
  if (b.description !== undefined) str(b.description, 'description');
  if (typeof b.timeout !== 'string' || !/^([1-9]\d*)(ms|s|m|h)$/.test(b.timeout)) fail('timeout requires a positive integer and ms, s, m or h.', 'timeout');
  if (obj(b.correlation, ['scope','primary','aliases'], 'correlation')) {
    if (b.correlation.scope !== 'device-session') fail('scope must be device-session.', 'correlation.scope');
    field(b.correlation.primary, 'correlation.primary');
    if (b.correlation.aliases !== undefined) {
      if (!Array.isArray(b.correlation.aliases) || b.correlation.aliases.length > 20) fail('aliases must be an array of at most 20 fields.', 'correlation.aliases');
      else b.correlation.aliases.forEach((v: unknown) => field(v, 'correlation.aliases'));
    }
  }
  const steps = new Map<string, Obj>();
  if (!Array.isArray(b.steps) || !b.steps.length || b.steps.length > 100) fail('steps requires 1–100 steps.', 'steps');
  else b.steps.forEach((s: unknown, i: number) => {
    const p = `steps.${i}`;
    if (!obj(s, ['id','shortLabel','name','optional','match','extract','next','outcome'], p)) return;
    str(s.id, p); str(s.name, p);
    if (s.shortLabel !== undefined) str(s.shortLabel, p);
    if (steps.has(s.id)) fail(`Duplicate step ID: ${s.id}`, p); else steps.set(s.id, s);
    if (s.optional !== undefined && typeof s.optional !== 'boolean') fail('optional must be boolean.', p);
    match(s.match, `${p}.match`, s.id); extract(s.extract, `${p}.extract`);
    if (s.outcome !== undefined && !['completed','failed','cancelled'].includes(s.outcome)) fail('Invalid outcome.', p);
    if (s.next !== undefined && (!Array.isArray(s.next) || !s.next.length || s.next.length > 100 || s.next.some((n: unknown) => typeof n !== 'string') || new Set(s.next).size !== s.next.length)) fail('next must contain unique step IDs.', p);
    if (s.outcome && s.next !== undefined) fail('Terminal steps cannot have outgoing edges.', p);
    if (!s.outcome && s.next === undefined) fail('Non-terminal steps need next.', p);
  });
  const predecessors = new Map<string, string[]>();
  for (const [id, s] of steps) for (const n of Array.isArray(s.next) ? s.next : []) {
    if (!steps.has(n)) fail(`Unknown successor: ${n}`, id);
    predecessors.set(n, [...(predecessors.get(n) ?? []), id]);
  }
  const reached = new Set<string>(), visiting = new Set<string>();
  const walk = (id: string) => {
    if (visiting.has(id)) { fail('Cycles are not supported.', id); return; }
    if (reached.has(id) || !steps.has(id)) return;
    reached.add(id); visiting.add(id);
    for (const n of Array.isArray(steps.get(id)!.next) ? steps.get(id)!.next : []) walk(n);
    visiting.delete(id);
  };
  if (!steps.has(b.start)) fail('start must reference a step.', 'start'); else walk(b.start);
  for (const [id, s] of steps) {
    if (!reached.has(id)) fail('Unreachable step.', id);
    if (s.optional && Array.isArray(s.next)) for (const parent of predecessors.get(id) ?? []) if (!s.next.every((next: string) => Array.isArray(steps.get(parent)!.next) && steps.get(parent)!.next.includes(next))) fail('Optional step requires an explicit bypass from each predecessor.', id);
  }
  if (![...steps.values()].some(s => reached.has(s.id) && s.outcome)) fail('A reachable terminal is required.', 'steps');
  if (b.errors !== undefined) {
    if (!Array.isArray(b.errors) || b.errors.length > 50) fail('errors must be an array of at most 50 rules.', 'errors');
    else {
      const errorIds = new Set<string>();
      b.errors.forEach((e: unknown, i: number) => {
        const p = `errors.${i}`;
        if (!obj(e, ['id','appliesTo','match','extract','codeField','codes','unknownOutcome'], p)) return;
        str(e.id, p); if (errorIds.has(e.id)) fail('Duplicate error ID.', p); errorIds.add(e.id);
        if (e.appliesTo !== 'active' && (!Array.isArray(e.appliesTo) || !e.appliesTo.length || e.appliesTo.some((id: string) => !steps.has(id)))) fail('appliesTo requires active or known step IDs.', p);
        match(e.match, `${p}.match`, `error:${i}`); extract(e.extract, `${p}.extract`); field(e.codeField, p);
        if (!e.extract?.[e.codeField]) fail('codeField must reference an extraction.', p);
        if (!['failed','cancelled'].includes(e.unknownOutcome)) fail('Invalid unknownOutcome.', p);
        if (obj(e.codes, Object.keys(e.codes ?? {}), `${p}.codes`)) for (const c of Object.values(e.codes)) if (obj(c, ['description','outcome'], p)) { str(c.description, p); if (!['failed','cancelled'].includes(c.outcome)) fail('Invalid error outcome.', p); }
      });
    }
  }
  // Stop before dependency analysis when shapes/edges are invalid. This also keeps
  // malformed drafts on the diagnostic path instead of dereferencing bad values.
  if (diagnostics.length) return { diagnostics };
  // A dominator is present on every path from start. Compute each node once in
  // topological order instead of recursively enumerating exponentially many paths.
  const order: string[] = [];
  const ordered = new Set<string>();
  const orderStep = (id: string): void => {
    if (ordered.has(id)) return;
    ordered.add(id);
    for (const next of steps.get(id)!.next ?? []) orderStep(next);
    order.push(id);
  };
  orderStep(b.start);
  const dominators = new Map<string, Set<string>>();
  for (const id of order.reverse()) {
    const parents = predecessors.get(id) ?? [];
    const common = id === b.start || !parents.length
      ? new Set<string>()
      : new Set(dominators.get(parents[0]!)!);
    for (const parent of parents.slice(1)) {
      for (const candidate of common) if (!dominators.get(parent)!.has(candidate)) common.delete(candidate);
    }
    common.add(id);
    dominators.set(id, common);
  }
  for (const r of references) {
    if (!steps.get(r.producer)?.extract?.[r.field]) fail('equalsFrom references an unknown step/extracted field.', r.path);
    else if (r.consumer.startsWith('error:') || r.producer === r.consumer || !dominators.get(r.consumer)?.has(r.producer)) fail('equalsFrom value must be available on every incoming route.', r.path);
  }
  if (!steps.get(b.start)?.extract?.[b.correlation?.primary]) fail('The start step must extract the primary correlation field.', 'correlation.primary');
  return diagnostics.length ? { diagnostics } : { blueprint: value as FlowBlueprint, diagnostics };
}

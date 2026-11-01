import { assignFlowVariables, flowScalar, flowStarts, type FlowVariableValue } from './flow-variables.js';
import type { FlowBlueprint, FlowError, FlowExtractor, FlowInstance, FlowLabel, FlowLabelPart, FlowResult } from './flow-types.js';

/** Template references name an exact blueprint node and one of its extraction keys. */
export function flowLabelReference(blueprint: FlowBlueprint, token: string): ({ stepId: string; field: string; extractor: FlowExtractor; variable?: never } | { variable: string; stepId?: never; field?: never; extractor?: never }) & { optional: boolean } | undefined {
  const optional = token.endsWith('?');
  if (optional) token = token.slice(0, -1);
  const nodes = [...blueprint.steps, ...(blueprint.errors ?? [])];
  if (token.startsWith('vars.')) {
    const variable = token.slice(5);
    if (nodes.some(node => Object.values(node.extract ?? {}).some(spec => spec.variable === variable))) return { variable, optional };
  }
  const candidates = nodes.flatMap(node => {
    const prefix = `${node.id}.`;
    if (!token.startsWith(prefix)) return [];
    const field = token.slice(prefix.length);
    if (!/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(field) || field.split('.').some(key => ['__proto__', 'prototype', 'constructor'].includes(key)) || !node.extract || !Object.hasOwn(node.extract, field)) return [];
    return [{ stepId: node.id, field, extractor: node.extract[field]!, optional }];
  });
  return candidates.length === 1 ? candidates[0] : undefined;
}

export interface FlowPresentation { label: FlowLabelPart[]; results: FlowResult[] }

/** Shared forward scan; list summaries do not allocate per-observation history. */
function scanPresentation(instance: FlowInstance, history?: FlowPresentation[]): FlowPresentation {
  const blueprint = instance.blueprint;
  const context = new Map<string, Record<string, unknown>>();
  const results = new Map<string, FlowResult>();
  const variables = new Map<string, FlowVariableValue>();
  let label: FlowLabelPart[] = [{ text: blueprint.name }];
  function render(template: FlowLabel | undefined): FlowLabelPart[] | undefined {
    if (template === undefined) return;
    const parts = typeof template === 'string' ? [{ text: template }] : template;
    const output: FlowLabelPart[] = [];
    for (const part of parts) {
      let offset = 0;
      const tone = part.tone ? { tone: part.tone } : {};
      for (const match of part.text.matchAll(/\{([^{}]+)\}/g)) {
        const reference = flowLabelReference(blueprint, match[1]!);
        const payload = reference?.stepId !== undefined ? context.get(reference.stepId) : undefined;
        const assignment = reference?.variable !== undefined ? variables.get(reference.variable) : undefined;
        const value = reference?.variable !== undefined ? assignment?.value : reference && payload && Object.hasOwn(payload, reference.field!) ? payload[reference.field!] : undefined;
        if (!flowScalar(value) && !reference?.optional) return;
        if (match.index > offset) output.push({ text: part.text.slice(offset, match.index), ...tone });
        if (flowScalar(value)) output.push({ text: String(value).slice(0, 4096), ...tone, ...(assignment?.sensitive || reference?.extractor?.sensitive ? { sensitive: true } : {}) });
        offset = match.index! + match[0].length;
      }
      if (offset < part.text.length) output.push({ text: part.text.slice(offset), ...tone });
    }
    return output.some(part => part.text.trim()) ? output : undefined;
  }
  label = render(blueprint.label) ?? label;
  for (const observation of instance.observations) {
    const accepted = observation.accepted !== false;
    const node = blueprint.steps.find(step => step.id === observation.stepId) ?? blueprint.errors?.find(error => error.id === observation.stepId);
    if (accepted && node) {
      context.set(node.id, observation.payload);
      assignFlowVariables(variables, node.extract, observation.payload);
      if (flowStarts(blueprint).includes(node.id)) label = render(blueprint.label) ?? label;
      for (const [field, extractor] of Object.entries(node.extract ?? {})) {
        if (!extractor.result || !Object.hasOwn(observation.payload, field) || observation.payload[field] === undefined) continue;
        results.set(field, { field, stepId: node.id, value: observation.payload[field], ...(extractor.sensitive ? { sensitive: true } : {}) });
      }
      const error = 'codeField' in node ? node as FlowError : undefined;
      const code = error ? String(observation.errorCode ?? observation.payload[error.codeField]) : undefined;
      const override = error && code !== undefined && Object.hasOwn(error.codes, code) ? error.codes[code]?.label : undefined;
      label = render(override ?? node.label) ?? label;
    }
    if (history) history.push({ label, results: [...results.values()] });
  }
  return { label, results: [...results.values()] };
}

/** Plain text only. Each substituted scalar is capped at 4096 UTF-16 code units. */
export function flowPresentation(instance: FlowInstance): FlowPresentation {
  return scanPresentation(instance);
}

/** One immutable presentation snapshot per occurrence, including unaccepted evidence. */
export function flowPresentationHistory(instance: FlowInstance): FlowPresentation[] {
  const history: FlowPresentation[] = [];
  scanPresentation(instance, history);
  return history;
}

/** Derived error-code decorations inherit the originating extractor's sensitivity. */
export function flowErrorCode(instance: FlowInstance, observation?: import('./flow-types.js').FlowObservation): { value?: string; sensitive: boolean } {
  let origin = observation;
  if (!origin) for (let index = instance.observations.length - 1; index >= 0; index--) {
    const candidate = instance.observations[index]!;
    if (candidate.accepted !== false && instance.blueprint.errors?.some(rule => rule.id === candidate.stepId)) { origin = candidate; break; }
  }
  const rule = instance.blueprint.errors?.find(rule => rule.id === origin?.stepId);
  return { value: observation ? observation.errorCode : instance.errorCode, sensitive: !!rule?.extract?.[rule.codeField]?.sensitive };
}

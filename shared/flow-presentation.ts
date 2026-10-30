import type { FlowBlueprint, FlowError, FlowExtractor, FlowInstance, FlowLabel, FlowLabelPart, FlowResult } from './flow-types.js';

/** Template references name an exact blueprint node and one of its extraction keys. */
export function flowLabelReference(blueprint: FlowBlueprint, token: string): { stepId: string; field: string; extractor: FlowExtractor } | undefined {
  const candidates = [...blueprint.steps, ...(blueprint.errors ?? [])].flatMap(node => {
    const prefix = `${node.id}.`;
    if (!token.startsWith(prefix)) return [];
    const field = token.slice(prefix.length);
    if (!/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(field) || field.split('.').some(key => ['__proto__', 'prototype', 'constructor'].includes(key)) || !node.extract || !Object.hasOwn(node.extract, field)) return [];
    return [{ stepId: node.id, field, extractor: node.extract[field]! }];
  });
  return candidates.length === 1 ? candidates[0] : undefined;
}

/** Plain text only. Each substituted scalar is capped at 4096 UTF-16 code units. */
export function flowPresentation(instance: FlowInstance): { label: FlowLabelPart[]; results: FlowResult[] } {
  const blueprint = instance.blueprint;
  const context = new Map<string, Record<string, unknown>>();
  const results = new Map<string, FlowResult>();
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
        const payload = reference && context.get(reference.stepId);
        const value = reference && payload && Object.hasOwn(payload, reference.field) ? payload[reference.field] : undefined;
        if (value === undefined || value === null || !['string', 'number', 'boolean'].includes(typeof value) || typeof value === 'number' && !Number.isFinite(value)) return;
        if (match.index > offset) output.push({ text: part.text.slice(offset, match.index), ...tone });
        output.push({ text: String(value).slice(0, 4096), ...tone, ...(reference!.extractor.sensitive ? { sensitive: true } : {}) });
        offset = match.index! + match[0].length;
      }
      if (offset < part.text.length) output.push({ text: part.text.slice(offset), ...tone });
    }
    return output;
  }
  label = render(blueprint.label) ?? label;
  for (const observation of instance.observations) {
    if (observation.accepted === false) continue;
    const node = blueprint.steps.find(step => step.id === observation.stepId) ?? blueprint.errors?.find(error => error.id === observation.stepId);
    if (!node) continue;
    context.set(node.id, observation.payload);
    if (node.id === blueprint.start) label = render(blueprint.label) ?? label;
    for (const [field, extractor] of Object.entries(node.extract ?? {})) {
      if (!extractor.result || !Object.hasOwn(observation.payload, field) || observation.payload[field] === undefined) continue;
      results.set(field, { field, stepId: node.id, value: observation.payload[field], ...(extractor.sensitive ? { sensitive: true } : {}) });
    }
    const error = 'codeField' in node ? node as FlowError : undefined;
    const code = error ? String(observation.errorCode ?? observation.payload[error.codeField]) : undefined;
    const override = error && code !== undefined && Object.hasOwn(error.codes, code) ? error.codes[code]?.label : undefined;
    label = render(override ?? node.label) ?? label;
  }
  return { label, results: [...results.values()] };
}

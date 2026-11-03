import type { FlowBlueprint, FlowExtractor } from './flow-types.js';

/** Both entry syntaxes share one runtime path; validation requires exactly one. */
export function flowStarts(blueprint: Pick<FlowBlueprint, 'start' | 'starts'>): readonly string[] {
  return blueprint.starts ?? (blueprint.start === undefined ? [] : [blueprint.start]);
}
export const flowScalar = (value: unknown): value is string | number | boolean =>
  ['string', 'number', 'boolean'].includes(typeof value) &&
  (typeof value !== 'number' || Number.isFinite(value));

export interface FlowVariableValue {
  value: string | number | boolean;
  sensitive: boolean;
}
/** A new accepted assignment supersedes the old one, including an absent value. */
export function assignFlowVariables(
  values: Map<string, FlowVariableValue>,
  fields: Record<string, FlowExtractor> | undefined,
  payload: Record<string, unknown>,
) {
  for (const [field, spec] of Object.entries(fields ?? {})) {
    if (!spec.variable) continue;
    const value = payload[field];
    if (flowScalar(value)) values.set(spec.variable, { value, sensitive: !!spec.sensitive });
    else values.delete(spec.variable);
  }
}

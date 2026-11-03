import type { FlowDiagnostic } from '../shared/flow-types';

export function diagnosticLocation(value: FlowDiagnostic) {
  return [
    value.sourceId,
    value.file &&
      [value.file, value.line, value.column].filter((part) => part !== undefined).join(':'),
    value.path,
  ]
    .filter(Boolean)
    .join(' · ');
}

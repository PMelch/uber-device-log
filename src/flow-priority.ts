import { isMap, isScalar, parseDocument } from 'yaml';
import type { FlowPriority } from '../shared/flow-types';

function draft(source: string) {
  const document = parseDocument(source);
  if (document.errors.length || document.warnings.length || !isMap(document.contents)) return;
  const node = document.get('priority', true);
  if (node !== undefined && (!isScalar(node) || !Number.isInteger(node.value) || Number(node.value) < 1 || Number(node.value) > 5)) return;
  return { document, node, value: (node === undefined ? 3 : node.value) as FlowPriority };
}
export function blueprintPriorityDraft(source: string): { value?: FlowPriority; editable: boolean } {
  try { const parsed = draft(source); return parsed ? { value: parsed.value, editable: true } : { editable: false }; }
  catch { return { editable: false }; }
}
/** Edit only a parseable mapping; preserve existing scalar comments and quote style. */
export function setBlueprintPriority(source: string, priority: number): string | undefined {
  if (!Number.isInteger(priority) || priority < 1 || priority > 5) return;
  try {
    const parsed = draft(source);
    if (!parsed) return;
    if (parsed.node && isScalar(parsed.node)) parsed.node.value = priority;
    else parsed.document.set('priority', priority);
    return parsed.document.toString();
  } catch { return; }
}

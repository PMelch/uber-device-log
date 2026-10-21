/** Card summary: observed steps plus the immediate expected steps. Later steps stay behind an ellipsis. */
export function flowSummary<T extends { id: string }>(steps: T[], observed: ReadonlySet<string>, expected: readonly string[]) {
  const shown = steps.filter(step => observed.has(step.id) || expected.includes(step.id));
  return { shown, continues: shown.length < steps.length };
}

/** IDs remain stable while the display is filtered or reversed. */
export function rangeKeys(rows: readonly {key: number}[], from: number, to: number): Set<number> {
  const start = rows.findIndex(row => row.key === from);
  const end = rows.findIndex(row => row.key === to);
  return start < 0 || end < 0 ? new Set() : new Set(rows.slice(Math.min(start,end),Math.max(start,end)+1).map(row => row.key));
}
export function selectedEntries<T extends {key:number}>(rows: readonly T[], keys: ReadonlySet<number>): T[] {
  return rows.filter(row => keys.has(row.key));
}

/** Presentation-only counterpart to ios-processes' anchored envelopes.
 * No Date conversion, inferred year/timezone, or capture/filter metadata changes. */
// Keep the process/PID envelope aligned with ios-processes.ts. Localized tokens
// are visual-only: recognizing one must not expand process filtering implicitly.
export interface IosHeaderSpan { start: number; end: number; kind?: string }
const month = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Jän|Mär|Mai|Okt|Dez|janv|févr|mars|avr|juin|juil|août|sept|oct|nov|déc|ene|abr|ago|dic|gen|mag|giu|lug|set)(?:\\.)?';
const time = '(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d';
const iso = '\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])[ T]' + time + '(?:\\.\\d+)?(?:Z|[+-](?:[01]\\d|2[0-3]):?[0-5]\\d)?';
const legacy = month + '[ \\t]+(?:[1-9]|[12]\\d|3[01])[ \\t]+' + time;
const envelope = '(?:([^\\s[\\]]+)[ \\t]+)?([^\\s([\\]]+)(\\([^\\r\\n()]+\\))?(\\[(\\d+)\\])[ \\t]+(<[A-Za-z]+>):';
const syslog = new RegExp('^(' + legacy + '|' + iso + ')[ \\t]+' + envelope, 'di');
const dated = new RegExp('^(' + iso + ')[ \\t]+([^\\s([\\]]+)(\\[(\\d+):\\d+\\])[ \\t]+', 'd');
const levels: Record<string, string> = { debug: 'debug', info: 'info', notice: 'notice', warning: 'warning', warn: 'warning', error: 'error', fault: 'fatal', fatal: 'fatal', critical: 'fatal', crit: 'fatal', alert: 'fatal', emergency: 'fatal', emerg: 'fatal' };
export function parseIosHeader(message: string): IosHeaderSpan[] | undefined {
  const sys = syslog.exec(message);
  const match = sys ?? dated.exec(message);
  if (!match || !Number.isSafeInteger(Number(match[sys ? 6 : 4]))) return;
  const fields: [number, string][] = sys
    ? [[1,'timestamp'],[2,'device'],[3,'process'],[4,'subsystem'],[5,'pid'],[7,levels[match[7]!.slice(1,-1).toLowerCase()] ?? 'level']]
    : [[1,'timestamp'],[2,'process'],[3,'pid']];
  const spans: IosHeaderSpan[] = [];
  let end = 0;
  for (const [index, kind] of fields) {
    const range = match.indices?.[index];
    if (!range) continue;
    if (range[0] > end) spans.push({start:end,end:range[0]});
    spans.push({start:range[0],end:range[1],kind}); end=range[1];
  }
  if (end < message.length) spans.push({start:end,end:message.length});
  return spans;
}

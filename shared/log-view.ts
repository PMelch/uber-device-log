import type { LogMessage, Platform } from './types';
export const logLevels = ['VERBOSE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'] as const;
export type LogLevel = typeof logLevels[number];
export function logLevel(level?: string): string {
  const aliases: Record<string, string> = { V: 'VERBOSE', D: 'DEBUG', I: 'INFO', W: 'WARN', E: 'ERROR', F: 'FATAL', A: 'FATAL' };
  return aliases[level ?? ''] ?? level ?? '';
}
export function filterLogLevels<T extends LogMessage>(messages: T[], platform: Platform | undefined, levels: readonly LogLevel[]): T[] {
  if (platform !== 'android' || logLevels.every(level => levels.includes(level))) return messages;
  return messages.filter(message => levels.includes(logLevel(message.level) as LogLevel));
}
export function formatLogMessages(messages: readonly LogMessage[]): string {
  return messages.map(entry => {
    const tag = `${entry.tag ?? ''}${entry.pid !== undefined ? `[${entry.pid}]` : ''}`;
    const metadata = [entry.level, tag].filter(Boolean).join(' ');
    return `${entry.timestamp} ${metadata ? `${metadata}: ` : ''}${entry.message}`;
  }).join('\n');
}

/** Preserve a native text selection exactly; otherwise export the displayed records. */
export function logExportText(messages: readonly LogMessage[], selection: string): string {
  return selection || formatLogMessages(messages);
}

export interface LogStackLine {
  kind: 'message' | 'exception' | 'frame' | 'cause' | 'omitted'
    | 'native-frame' | 'signal' | 'section' | 'thread' | 'registers' | 'diagnostic' | 'metadata';
  text: string;
  location?: string;
}

/** Recognize console envelopes without deleting them from the displayed/raw text. */
function logContent(text: string): string {
  return text.replace(/^(?:[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+(?:\S+\s+)?\S+\[\d+(?::\d+)?\]\s+<\w+>:\s*|\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d[.\d+-]*\s+\S+\[\d+:\d+\]\s*)/, '');
}

function classifyStackLine(raw: string): LogStackLine {
  // Existing Java formatting decodes only indentation tab entities, never HTML.
  const text = raw.replace(/^(?:[\t ]|&#(?:x0*9|0*9);)+/i, indent => indent.replace(/&#(?:x0*9|0*9);/gi, '\t'));
  const content = logContent(text);
  const frame = /^(\s*at\s+\S+)(\([^()\r\n]*\)\s*)$/.exec(content);
  if (frame) return { kind: 'frame', text: text.slice(0, text.length - frame[2]!.length), location: frame[2]! };
  // Symbol names may contain nested parentheses; keep the complete suffix intact.
  const native = /^(\s*(?:#\d+\s+(?:pc\s+)?(?:0x)?[\da-f]+\s+|\d+\s+\S+\s+0x[\da-f]+\s+))(.+)$/i.exec(content);
  if (native) return { kind: 'native-frame', text: text.slice(0, text.length - native[2]!.length), location: native[2]! };
  const managed = /^(\s*(?:at\s+)?[\w.$+`<>]+[.:][^\r\n]+?)(\s+\(at\s+[^\r\n]+:\d+\)|\s+in\s+[^\r\n]+:\s*line\s+\d+)\s*$/.exec(content);
  if (managed) {
    const offset = text.lastIndexOf(managed[2]!);
    return { kind: 'frame', text: text.slice(0, offset), location: text.slice(offset) };
  }
  if (/^\s*(?:Caused by:|Suppressed:|Cause:|Abort message:)/.test(content)) return { kind: 'cause', text };
  if (/^\s*\.\.\.\s+\d+\s+more\s*$/.test(content)) return { kind: 'omitted', text };
  if (/^\s*(?:(?:Fatal )?signal\s+\d+\s+\(SIG[A-Z]+\)|Exception Type:\s+EXC_[A-Z_]+|Termination (?:Reason|Signal):)/i.test(content)) return { kind: 'signal', text };
  if (/^\s*(?:(?:[\w$]+\.)*[\w$]*(?:Exception|Error)(?::|$)|FATAL EXCEPTION:\s*\S|\*{3}\s+Terminating app due to uncaught exception|libc\+\+abi:\s+terminating|(?:[^\r\n]+\.swift:\d+:\s*)?(?:Fatal error|Precondition failed|Assertion failed):)/.test(content)) return { kind: 'exception', text };
  if (/^\s*(?:ANR in\s+\S|Reason:\s+Input dispatching timed out|(?:ERROR:\s*)?(?:AddressSanitizer|HWAddressSanitizer|UndefinedBehaviorSanitizer):|(?:==\d+==)?ERROR:\s*(?:AddressSanitizer|HWAddressSanitizer):|FORTIFY:|Scudo ERROR:|JNI DETECTED ERROR IN APPLICATION:|memorystatus:\s+killing\s+process|JetsamEvent:|Termination Description:|Exception (?:Subtype|Codes|Message|Note):)/.test(content)) return { kind: 'diagnostic', text };
  if (/^\s*(?:Thread\s+\d+(?::|\s+(?:Crashed:|name:|crashed with\b))|Crashed Thread:|Triggered by Thread:|"[^"]+"\s+(?:daemon\s+)?prio=\d+\s+tid=\d+|\s*-\s+(?:waiting to lock|locked|parking to wait for)\s+<)/i.test(content)) return { kind: 'thread', text };
  if (/^\s*(?:backtrace:|Last Exception Backtrace:|\*{3}\s+First throw call stack:|Binary Images:|VM Region (?:Info|Summary):|\*{3}(?:\s+\*{3}){3,})\s*$/i.test(content)) return { kind: 'section', text };
  if (/^\s*(?:[xr]\d{1,2}|sp|lr|pc|ip|fp|cpsr|[re](?:ax|bx|cx|dx|si|di|bp|sp|ip))\s*:?\s+(?:0x)?[\da-f]{8,}\b/i.test(content)) return { kind: 'registers', text };
  if (/^\s*(?:pid:\s*\d+,\s*tid:|Process:\s+\S.*,\s*PID:\s*\d+|Build fingerprint:|ABI:|Cmdline:|Tombstone written to:)/.test(content)) return { kind: 'metadata', text };
  return { kind: 'message', text };
}

/** Whitespace-only JSON layout: never round 64-bit addresses or change string escapes. */
function indentCrashJson(source: string): string {
  let result = '', depth = 0, quoted = false, escaped = false;
  const newline = () => { result = result.trimEnd() + '\n' + '  '.repeat(depth); };
  for (const character of source) {
    if (quoted) {
      result += character;
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') { quoted = true; result += character; }
    else if (character === '{' || character === '[') { result += character; depth++; if (depth > 64) throw new Error('Crash JSON nesting limit'); newline(); }
    else if (character === '}' || character === ']') { depth--; newline(); result += character; }
    else if (character === ',') { result += character; newline(); }
    else if (character === ':') result += ': ';
    else if (!/\s/.test(character)) result += character;
  }
  return result;
}

function parseCrashJson(message: string): LogStackLine[] | undefined {
  if (!message.trimStart().startsWith('{') || message.length > 262144) return;
  try {
    let body: Record<string, unknown>;
    let documents = [message];
    try { body = JSON.parse(message); }
    catch {
      const split = message.indexOf('\n');
      if (split < 0) return;
      const header = JSON.parse(message.slice(0, split));
      if (!['309', '298'].includes(String(header?.bug_type))) return;
      body = JSON.parse(message.slice(split + 1));
      documents = [message.slice(0, split), message.slice(split + 1)];
    }
    const exception = body?.exception as { type?: unknown } | undefined;
    const crash = typeof exception?.type === 'string' && /^EXC_/.test(exception.type) && Array.isArray(body.threads);
    const jetsam = body?.memoryStatus && Array.isArray(body.processes);
    if (!crash && !jetsam) return;
    return documents.flatMap(document => indentCrashJson(document).split('\n').map((text): LogStackLine => ({
      kind: /"(?:type|signal)":\s*"(?:EXC_|SIG)/.test(text) ? 'signal'
        : /"(?:exception|termination|threads|frames|usedImages|memoryStatus|processes)":/.test(text) ? 'section'
        : /"(?:reason|subtype|codes|indicator|namespace)":/.test(text) ? 'diagnostic'
        : /"(?:symbol|imageOffset|imageIndex|symbolLocation)":/.test(text) ? 'native-frame' : 'metadata',
      text,
    })));
  } catch { return; } // Truncated/unknown reports remain visible as unmodified raw text.
}

/** Presentation only: never change stored records or infer missing frames/symbols. */
export function parseLogStack(message: string): LogStackLine[] | undefined {
  if (message.trimStart().startsWith('{')) return parseCrashJson(message);
  // Cheap gate for ordinary messages; full line rules decide whether this is diagnostic text.
  if (!/(?:\bat\s|Exception|Error|signal|EXC_|Thread|backtrace|#\d|0x|Fatal error:|Precondition failed:|Assertion failed:|terminating|ANR in|Sanitizer|FORTIFY:|Scudo|JetsamEvent:|memorystatus:|\.cs:\d|Termination |Abort message:|Caused by:|Suppressed:|Cause:|Binary Images:|VM Region |JNI DETECTED|(?:^|\n)\s*(?:[xr]\d{1,2}|sp|lr|pc|ip|fp|cpsr)\s+\w{8}|\*\*\*)/i.test(message)) return;
  const lines = message.split(/\r?\n/).map(classifyStackLine);
  return lines.some(line => line.kind !== 'message' && line.kind !== 'metadata') ? lines : undefined;
}

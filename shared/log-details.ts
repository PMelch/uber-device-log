import type { LogMessage, Platform } from './types';
import { parseLogStack } from './log-view';

export type Interpretation = 'generic' | 'audio' | 'brightness' | 'lux' | 'dns' | 'power' | 'invalidType' | 'stack' | 'fileRead';
export interface ParsedLogDetails {
  format: 'android-structured' | 'ios-syslog' | 'unrecognized';
  deviceTimestamp?: string;
  host?: string;
  process?: string;
  component?: string;
  pid?: string;
  level?: string;
  tag?: string;
  sourceLocation?: string;
  fileFailure?: FileReadFailure;
  body: string;
  hasPrivateData: boolean;
  interpretation: Interpretation;
}

export interface FileReadFailure {
  operation: string;
  path: string;
  exception: string;
  errorCode: string;
  reason: string;
  segments: string[];
}

/** Recognize the complete readFile failure shape; keep display segments lossless. */
export function parseFileReadFailure(message: string): FileReadFailure | undefined {
  const match = /^(readFile (\/[^\r\n]+?) failed: )(java\.io\.FileNotFoundException)(: (\/[^\r\n]+?): open failed: )([A-Z][A-Z0-9_]*)( \(([^\r\n]+)\))$/.exec(message);
  if (!match) return;
  const path = match[2];
  if (path !== match[5]) return;
  return { operation: 'readFile', path, exception: match[3], errorCode: match[6], reason: match[8],
    segments: [match[1], match[3] + match[4], match[6] + match[7]] };
}

/** Parse one record only. Never inherit fields from neighboring/interleaved records. */
export function interpretLog(entry: LogMessage, platform: Platform): ParsedLogDetails {
  const parsed: ParsedLogDetails = {
    format: platform === 'android' ? 'android-structured' : 'unrecognized',
    body: entry.message,
    hasPrivateData: /<private>/.test(entry.message),
    interpretation: 'generic',
  };
  if (platform === 'android') {
    parsed.level = entry.level;
    parsed.tag = entry.tag;
    if (entry.pid !== undefined) parsed.pid = String(entry.pid);
  } else {
    // The relay's legacy syslog envelope has no year or timezone. Retain it as text.
    const header = /^([A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+(\S+)\s+([^\s([\]]+)(?:\(([^)\r\n]+)\))?\[(\d+)\]\s+<([^>\r\n]+)>:\s?/.exec(entry.message);
    if (header) {
      parsed.format = 'ios-syslog';
      [, parsed.deviceTimestamp, parsed.host, parsed.process, parsed.component, parsed.pid, parsed.level] = header;
      parsed.body = entry.message.slice(header[0].length);
    }
  }
  const source = /^\s*([^\s:]+\.(?:cpp|cc|c|mm|m|h|hpp|swift|java|kt|cs)):(\d+)\s+/.exec(parsed.body);
  if (source) parsed.sourceLocation = `${source[1]}:${source[2]}`;

  // Explanations describe visible evidence, never infer a root cause or system health.
  parsed.fileFailure = parseFileReadFailure(parsed.body);
  if (parsed.fileFailure) parsed.interpretation = 'fileRead';
  else if (parseLogStack(parsed.body)) parsed.interpretation = 'stack';
  else if (parsed.format === 'ios-syslog') {
    if (parsed.process === 'appleh16camerad' && /\bGetLuxInfo\b/.test(parsed.body)) parsed.interpretation = 'lux';
    else if (parsed.process === 'wifid' && /\b(?:kWiFiUsageFaultReason)?SlowWiFiDnsFailure\b/.test(parsed.body)) parsed.interpretation = 'dns';
    else if (parsed.process === 'kernel' && parsed.component === 'AppleSPU' && /Error setting grimaldi power state/.test(parsed.body)) parsed.interpretation = 'power';
    else if (parsed.process === 'mobileassetd' && /invalid type for input:/.test(parsed.body)) parsed.interpretation = 'invalidType';
    else if (parsed.component === 'CoreBrightness' && /\b(?:HDR|Lux|Nits)\b/.test(parsed.body)) parsed.interpretation = 'brightness';
    else if (/^(?:AudioToolboxCore|AudioToolbox|libEmbeddedSystemAUs\.dylib|VirtualAudio)$/.test(parsed.component ?? '')) parsed.interpretation = 'audio';
  }
  return parsed;
}

/** A diagnostic view of one message, separate from the stable full-log export schema. */
export function logDetailsJson(entry: LogMessage, platform: Platform, parsed: ParsedLogDetails): string {
  const { timestamp, message, level, tag, pid } = entry;
  return JSON.stringify({
    platform,
    timestampSource: platform === 'ios' ? 'host-receipt' : 'device',
    original: { timestamp, message, level, tag, pid },
    parsed,
  }, null, 2);
}

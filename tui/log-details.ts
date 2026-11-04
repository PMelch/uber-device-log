import { interpretLog, logDetailsJson, type Interpretation } from '../shared/log-details';
import { formatLogMessages } from '../shared/log-view';
import type { Device, LogMessage } from '../shared/types';
import { translate, type Locale } from '../src/i18n';
import type { MessageKey } from '../src/i18n/en';
import { terminalText } from './model';

export type DetailView = 'fields' | 'raw' | 'json';
const interpretations: Record<Interpretation, MessageKey> = {
  fileRead: 'detailFileRead', generic: 'detailGeneric', audio: 'detailAudio', brightness: 'detailBrightness', lux: 'detailLux',
  dns: 'detailDns', power: 'detailPower', invalidType: 'detailInvalidType', stack: 'detailStack',
};

/** Same interpretation and diagnostic JSON as the web inspector; logs stay verbatim. */
export function renderLogDetails(entry: LogMessage, view: DetailView, locale: Locale, device?: Device): string {
  const platform = entry.source?.platform ?? device?.platform ?? 'android';
  const webview = !!(entry.source?.webview ?? device?.webview);
  const parsed = interpretLog(entry, platform, webview);
  if (view === 'raw') return terminalText(formatLogMessages([entry]));
  if (view === 'json') {
    const diagnostic = JSON.parse(logDetailsJson(entry, platform, parsed));
    diagnostic.original = { ...diagnostic.original, source: entry.source, truncated: entry.truncated };
    return terminalText(JSON.stringify(diagnostic, null, 2));
  }
  const t = (key: MessageKey) => translate(locale, key);
  const ios = platform === 'ios' && !webview;
  const fields: [MessageKey, string | undefined][] = [
    [ios ? 'detailReceived' : 'detailTimestamp', entry.timestamp],
    ['detailDevice', device?.name ?? entry.source?.deviceId],
  ];
  if (ios) fields.push(['detailDeviceTime', parsed.deviceTimestamp], ['detailHost', parsed.host], ['detailProcess', parsed.process], ['detailComponent', parsed.component]);
  else fields.push(['detailTag', parsed.tag]);
  fields.push(['detailPid', parsed.pid], ['detailLevel', parsed.level]);
  if (parsed.sourceLocation) fields.push(['detailSource', parsed.sourceLocation]);
  if (parsed.fileFailure) fields.push(['detailOperation', parsed.fileFailure.operation], ['detailPath', parsed.fileFailure.path],
    ['detailException', parsed.fileFailure.exception], ['detailErrorCode', parsed.fileFailure.errorCode], ['detailReason', parsed.fileFailure.reason]);
  const notes = [parsed.format === 'unrecognized' ? t('detailNoHeader') : '', parsed.deviceTimestamp ? t('detailTimeNote') : '',
    parsed.hasPrivateData ? t('detailPrivate') : ''].filter(Boolean);
  return terminalText([
    ...fields.map(([key, value]) => `${t(key)}: ${value ?? t('detailUnavailable')}`),
    ...(parsed.interpretation === 'generic' ? [] : ['', t('detailInterpretation'), t(interpretations[parsed.interpretation])]),
    ...notes,
    '', t('detailTabRaw'), entry.message,
  ].join('\n'));
}

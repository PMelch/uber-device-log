import { createFlowSources } from './flow-sources';
import { createTuiUpdateNotice } from './update-notice';
import { version } from '../package.json';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { createCliRenderer } from '@opentui/core';
import { catalogs, resolveLocale, translate, type Locale } from '../src/i18n';
import { serializeLogExport } from '../shared/log-export';
import { createTuiFlows, type TuiFlows } from './flows-model';
import { FlowProject } from '../server/flow-project';
import { createTui } from './app';
import { createLocalClient } from './local-client';
import { initializeProject } from '../server/project-context';
import { createTuiClient } from './client';
import { demoDevice, demoMessages } from './demo';

export async function main(startup: { setLabel(label: string): void; stop(): void }) {
  const { values } = parseArgs({ options: {
    local: { type: 'boolean' }, project: { type: 'string' }, help: { type: 'boolean', short: 'h' }, server: { type: 'string' }, locale: { type: 'string' },
    records: { type: 'string', default: '2000' }, 'export-dir': { type: 'string', default: '.' },
  }, strict: true, allowPositionals: false });
  if (values.help) {
    console.log(`Über Device Log — OpenTUI proof of concept
Usage: bun tui/index.ts [options]
       ./build/udl-tui [options]

Default: fictional live demo; no phone or server required.
  --local                       Direct device capture without a web server
  --project <dir>               Project context for --local
  --server http://127.0.0.1:4310  Choose one source from a running UDL server
  --records 2000                 Retained capacity and initial demo size (1–100000)
  --locale en                    en, de, es, fr, it, ja, zh-CN
  --export-dir .                 Save JSON here using a unique filename
  --help                        Show this help

Tab/Shift+Tab: focus; Enter/Space: activate; arrows/PageUp/PageDown: logs.
Mouse: buttons, source selection, log inspection, wheel, detail text selection.
Scrolling or inspecting freezes the view while capture continues.
Back to live resumes following. Save exports the inspected record or filtered view.
Ctrl+C or Quit exits the client. The separately running server stays active.`);
    return;
  }
  if (values.local && values.server) throw new Error('Use --local or --server, not both.');
  if (values.project && !values.local) throw new Error('--project requires --local.');
  const capacity = Number(values.records);
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100000) throw new Error('--records must be an integer from 1 to 100000.');
  if (values.locale && !Object.hasOwn(catalogs, values.locale)) throw new Error('Unsupported --locale. See --help.');
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('An interactive terminal is required. Use --help for options.');
  const locale = (values.locale as Locale | undefined) ?? resolveLocale(null, [process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || 'en']);
  startup.setLabel(translate(locale, 'appLoading'));
  const project = values.local ? initializeProject(values.project) : undefined;
  let device = demoDevice;
  let flows: TuiFlows | undefined;
  let app: ReturnType<typeof createTui> | undefined;
  const callbacks = { gap: () => flows?.gap(), ended: (live: boolean) => { if (!live) flows?.interrupt(); }, logs: (records: import('../shared/types').LogMessage[]) => app?.ingest(records),
    status: (message: import('../src/i18n').UiMessage | string, live: boolean) => app?.setStatus(message, live) };
  const local = values.local ? createLocalClient(callbacks, { list: (await import('../server/devices')).listDevices, open: (await import('../server/devices')).openLogs }) : undefined;
  const client = values.server ? createTuiClient(values.server, {
    logs: records => app?.ingest(records), status: (message, live) => app?.setStatus(message, live),
  }) : undefined;
  startup.stop();
  const renderer = await createCliRenderer({ exitOnCtrlC: false, useMouse: true, enableMouseMovement: true }).catch(error => { local?.close(); client?.close(); throw error; });
  let timer: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  let updateNotice: ReturnType<typeof createTuiUpdateNotice> | undefined;
  const cleanup = () => {
    if (closed) return;
    closed = true; updateNotice?.dispose(); clearInterval(timer); client?.close(); local?.close(); app?.dispose(); flows?.dispose();
    process.off('SIGTERM', quit); process.off('SIGINT', quit);
  };
  function quit() { cleanup(); renderer.destroy(); }
  renderer.on('destroy', cleanup);
  renderer.keyInput.on('keypress', key => { if (key.ctrl && key.name === 'c') { key.preventDefault(); quit(); } });
  process.once('SIGTERM', quit); process.once('SIGINT', quit);
  try {
    if (local) {
      let registry: Promise<FlowProject> | undefined;
      const getProject = () => registry ??= FlowProject.create(project?.directory).catch(error => { registry = undefined; throw error; });
      const sources = createFlowSources({ project: getProject, changed: async () => { await flows?.reload(true); } });
      flows = createTuiFlows({ sources, load: async () => (await getProject()).reload() });
      void flows.reload();
    }
    app = createTui(renderer, {
      acquireConsole: local ? (await import('../server/devices')).acquireWebView : undefined,
      flows, locale, capacity, demo: !client && !local, quit, project: project?.directory,
      syncSources: local ? selected => { if (selected[0]) device = selected[0]; local.sync(selected); } : undefined,
      sources: () => local ? local.sources() : client ? client.sources() : Promise.resolve([demoDevice]),
      chooseSource: selected => { device = selected; client?.select(selected); },
      async save(records, order) {
        const path = resolve(values['export-dir']!, `udl-tui-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.json`);
        await writeFile(path, serializeLogExport(records, device, 'json', order).text, { flag: 'wx', mode: 0o600 });
        return path;
      },
    });
    if (!client && !local) {
      app.ingest(demoMessages(0, capacity));
      let sequence = capacity;
      timer = setInterval(() => { app?.ingest(demoMessages(sequence, 10)); sequence += 10; }, 100);
    } else app.setStatus({ code: 'selectDevice' }, false);
    updateNotice = createTuiUpdateNotice(version, notice => app?.setUpdate(notice));
    await renderer.closed;
  } finally { quit(); }
}


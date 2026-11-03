import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FlowProject } from '../../server/flow-project';
import { createTuiFlows } from '../flows-model';
const home = await mkdtemp(join(tmpdir(), 'udl-flow-smoke-'));
const flows = createTuiFlows({ pollMs: 0, load: async () => (await FlowProject.create(process.argv[2], { home })).reload() });
try {
  await flows.reload();
  const messages = (await readFile(join(process.argv[2]!, 'sample-events.jsonl'), 'utf8')).trim().split('\n').map(message => ({ timestamp: '2026-11-03T12:00:00Z', message, source: { key: 'fixture', deviceId: 'fixture', name: 'Fixture', platform: 'android' as const } }));
  flows.ingest(messages);
  for (let i = 0; i < 100 && !flows.state.instances.some(item => item.outcome === 'completed'); i++) await new Promise(r => setTimeout(r, 10));
  if (!flows.state.instances.some(item => item.outcome === 'completed')) throw new Error(JSON.stringify(flows.error ?? flows.state));
  console.log('flow project worker: completed');
} finally { flows.dispose(); await rm(home, { recursive: true, force: true }); }

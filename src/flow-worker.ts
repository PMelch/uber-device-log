/// <reference lib="webworker" />
import { createFlowEngine } from '../shared/flow-engine';
import type { FlowCommand } from './flow-analysis';
const engine = createFlowEngine(() => performance.timeOrigin + performance.now());
let sentVersion = -1;
self.onmessage = (event: MessageEvent<FlowCommand & { id: number }>) => {
  const command = event.data;
  try {
    if (command.type === 'snapshot') engine.setBlueprints(command.blueprints, command.revision);
    else if (command.type === 'ingest') engine.ingest(command.messages);
    else if (command.type === 'clear') engine.clear();
    else if (command.type === 'interrupt') engine.interrupt();
    else if (command.type === 'gap') engine.gap();
    else engine.tick();
    const version = engine.getVersion();
    self.postMessage({ id: command.id, ...(command.type === 'snapshot' ? { activatedRevision: command.revision } : {}), ...(sentVersion !== version ? { state: engine.getState() } : {}) });
    sentVersion = version;
  } catch (error) { self.postMessage({ id: command.id, error: error instanceof Error ? error.message : String(error) }); }
};

import { FlowProject } from './flow-project.js';
import type { parseCliOptions } from './cli-options.js';
/** The install command deliberately never imports the device or HTTP server entry point. */
export async function runBlueprintInstall(options: ReturnType<typeof parseCliOptions>, runtime: { home?: string; fetch?: typeof fetch } = {}): Promise<string> {
  if (!options.install) throw new Error('No Blueprint installation requested.');
  const project = await FlowProject.create(options.project, runtime);
  const previous = new Set((await project.reload()).sources?.map(source => source.id));
  const result = await project.installBundle(options.install.url, options.install.scope);
  const installed = result.sources?.find(source => source.kind === 'bundle' && source.scope === options.install!.scope && !previous.has(source.id));
  if (!installed) throw new Error('Bundle was installed, but its source could not be loaded. Check configuration diagnostics.');
  return `Installed ${installed.name} (${installed.filename}) in ${installed.scope} scope. Disabled; enable it in Blueprint sources.`;
}

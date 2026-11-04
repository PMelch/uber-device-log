import { resolve } from 'node:path';

export function parseCliOptions(args: string[], environmentPort?: string) {
  // npx and bunx can forward the separator after the package name.
  if (args[0] === '--') args = args.slice(1);
  let portText = environmentPort ?? '4310';
  let project: string | undefined;
  let help = false;
  let tui = false;
  let version = false;
  const installing = args[0] === 'install-blueprint';
  let installSource: string | undefined, global = false;
  for (let index = installing ? 1 : 0; index < args.length; index++) {
    const arg = args[index]!;
    if (installing && !arg.startsWith('-') && installSource === undefined) { installSource = arg; continue; }
    if (installing && arg === '--global') { if (global) throw new Error('Use --global only once.'); global = true; continue; }
    if (arg === '--tui' && !installing) tui = true;
    else if (arg === '--help' || arg === '-h') help = true;
    else if (arg === '--version' || arg === '-v') version = true;
    else if (arg === '--project' || arg === '--flows' || arg.startsWith('--project=') || arg.startsWith('--flows=')) {
      if (project !== undefined) throw new Error('Use --project or --flows only once.');
      const value = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : args[++index];
      if (!value || value.startsWith('-')) throw new Error(`${arg} requires a project directory.`);
      project = resolve(value);
    }
    else if (arg === '--port' || arg === '-p') {
      const value = args[++index];
      if (!value) throw new Error(`${arg} requires a port number.`);
      portText = value;
    } else if (arg.startsWith('--port=')) portText = arg.slice(7);
    else throw new Error(`Unknown argument: ${arg}. Use --help for usage.`);
  }
  if (help || version) return { port: 4310, help, version, ...(project === undefined ? {} : { project }) };
  if (installing && (!installSource || global === (project !== undefined))) throw new Error('Usage: udl install-blueprint <file-or-url> --global | --project <dir>');
  const install = installing ? { source: installSource!, scope: global ? 'global' as const : 'project' as const } : undefined;
  const port = Number(portText);
  if (!/^\d+$/.test(portText) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Port must be an integer between 1 and 65535.');
  }
  return { port, help, version, ...(tui ? { tui } : {}), ...(install ? { install } : {}), ...(project !== undefined ? { project } : {}) };
}

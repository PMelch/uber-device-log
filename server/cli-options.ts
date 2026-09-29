export function parseCliOptions(args: string[], environmentPort?: string) {
  let portText = environmentPort ?? '4310';
  let help = false;
  let version = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === '--help' || arg === '-h') help = true;
    else if (arg === '--version' || arg === '-v') version = true;
    else if (arg === '--port' || arg === '-p') {
      const value = args[++index];
      if (!value) throw new Error(`${arg} requires a port number.`);
      portText = value;
    } else if (arg.startsWith('--port=')) portText = arg.slice(7);
    else throw new Error(`Unknown argument: ${arg}. Use --help for usage.`);
  }
  if (help || version) return { port: 4310, help, version };
  const port = Number(portText);
  if (!/^\d+$/.test(portText) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Port must be an integer between 1 and 65535.');
  }
  return { port, help, version };
}

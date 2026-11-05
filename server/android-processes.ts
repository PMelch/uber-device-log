import type { Duplex } from 'node:stream';
import type { AndroidProcess } from '../shared/types.js';

export function parseAndroidProcesses(text: string): AndroidProcess[] {
  const lines = text.trim().split(/\r?\n/);
  if (!/^\s*PID\s+NAME\s*$/.test(lines.shift() || '')) throw new Error('Unsupported process list');
  return lines.filter(line => line.trim()).map(line => {
    const match = /^\s*(\d+)\s+(\S(?:.*\S)?)\s*$/.exec(line);
    const pid = Number(match?.[1]);
    if (!match || !Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid process list');
    return { pid, name: match[2] };
  });
}

/** Fixed command: user search text never reaches the device shell. */
export async function discoverAndroidProcesses(device: { shell(command: string): PromiseLike<Duplex> }, timeout = 5000): Promise<AndroidProcess[]> {
  let stream: Duplex | undefined;
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { expired = true; stream?.destroy(new Error('Process discovery timed out')); reject(new Error('Process discovery timed out')); }, timeout);
  });
  const read = async () => {
    const socket = await device.shell('ps -A -o PID,NAME');
    if (expired) { socket.destroy(); throw new Error('Process discovery timed out'); }
    stream = socket;
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of socket) {
      const buffer = Buffer.from(chunk);
      size += buffer.length;
      if (size > 1024 * 1024) throw new Error('Process list too large');
      chunks.push(buffer);
    }
    return parseAndroidProcesses(Buffer.concat(chunks).toString('utf8'));
  };
  try { return await Promise.race([read(), deadline]); }
  finally { clearTimeout(timer); stream?.destroy(); }
}

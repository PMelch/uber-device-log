import type { Device, DeviceSetup, DeviceSetupIssue } from '../shared/types.js';

/** Discovery itself probes the transports; an empty successful response is healthy. */
export function deviceSetup(results: readonly [PromiseSettledResult<Device[]>, PromiseSettledResult<Device[]>], platform: string = process.platform): DeviceSetup {
  const host = platform === 'win32' ? 'windows' : platform === 'darwin' ? 'macos' : platform === 'linux' ? 'linux' : 'other';
  const issues: DeviceSetupIssue[] = [];
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      const error = result.reason;
      const detail = error instanceof Error ? error.message : String(error);
      // ENOENT on a socket is not evidence that the adb executable is missing.
      const missing = index === 0 && ((error?.code === 'ENOENT' && String(error?.syscall).startsWith('spawn')) || /^spawn .+ ENOENT$/.test(detail));
      issues.push({ platform: index === 0 ? 'android' : 'ios', reason: index === 1 ? 'iosUnavailable' : missing ? 'adbMissing' : 'androidUnavailable', detail });
    } else if (index === 0) {
      for (const [state, reason] of [['unauthorized', 'androidUnauthorized'], ['no permissions', 'androidPermissions']] as const) {
        const affected = result.value.filter(device => device.state === state);
        if (affected.length) issues.push({ platform: 'android', reason, detail: affected.map(device => `${device.id}: ${device.state}`).join('\n') });
      }
    }
  });
  return { host, issues };
}

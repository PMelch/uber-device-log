import { expect, test } from 'bun:test';
import { createTuiUpdateNotice, type TuiUpdateNotice } from './update-notice';

const response = (version: string) => new Response(JSON.stringify({ version }));

test('startup update check reports a newer release once without package-manager advice', async () => {
  const notices: TuiUpdateNotice[] = []; let calls = 0;
  const check = createTuiUpdateNotice('0.10.0', notice => notices.push(notice), async () => { calls++; return response('0.11.0'); });
  expect(notices).toEqual([]);
  await check.done;
  expect(calls).toBe(1);
  expect(notices).toEqual([{ currentVersion: '0.10.0', latestVersion: '0.11.0', changelogUrl: 'https://github.com/PMelch/uber-device-log/blob/main/CHANGELOG.txt' }]);
});

test('current, older, invalid and failed registry responses remain silent', async () => {
  for (const request of [async () => response('0.10.0'), async () => response('0.9.0'), async () => response('invalid'), async () => { throw new Error('offline'); }]) {
    const notices: TuiUpdateNotice[] = [];
    await createTuiUpdateNotice('0.10.0', notice => notices.push(notice), request).done;
    expect(notices).toEqual([]);
  }
});

test('closing the terminal suppresses a late update result', async () => {
  let finish!: (value: Response) => void;
  const notices: TuiUpdateNotice[] = [];
  const check = createTuiUpdateNotice('0.10.0', notice => notices.push(notice), () => new Promise(resolve => { finish = resolve; }));
  check.dispose(); finish(response('0.11.0')); await check.done;
  expect(notices).toEqual([]);
});

test('a registry request that never responds times out silently', async () => {
  let signal: AbortSignal | null | undefined;
  const notices: TuiUpdateNotice[] = [];
  const check = createTuiUpdateNotice('0.10.0', notice => notices.push(notice), async (_url, options) => { signal = options?.signal; return new Promise(() => {}); }, 5);
  await check.done;
  expect(signal?.aborted).toBe(true);
  expect(notices).toEqual([]);
});

test('disposing cancels the registry request and settles without waiting for its timeout', async () => {
  let signal: AbortSignal | null | undefined;
  const check = createTuiUpdateNotice('0.10.0', () => { throw new Error('must stay silent'); }, async (_url, options) => {
    signal = options?.signal; return new Promise(() => {});
  });
  check.dispose();
  expect(signal?.aborted).toBe(true);
  await check.done;
});

import { test, expect } from 'bun:test';
import * as startup from './startup-spinner';

test('startup spinner paints immediately, advances, and clears exactly once', () => {
  expect(typeof startup.startStartupSpinner).toBe('function');
  const writes: string[] = [];
  let tick = () => {}; let cancelled = 0;
  const spinner = startup.startStartupSpinner('Loading…', {
    write: text => { writes.push(text); },
    schedule: callback => { tick = callback; return () => { cancelled++; }; },
  });
  expect(writes[0]).toContain('Loading…');
  tick(); expect(writes[1]).not.toBe(writes[0]);
  spinner.setLabel('Wird geladen…'); expect(writes.at(-1)).toContain('Wird geladen…');
  spinner.stop(); spinner.stop();
  expect(cancelled).toBe(1);
  expect(writes.at(-1)).toBe('\r\x1b[2K');
  const count = writes.length; tick(); spinner.setLabel('late');
  expect(writes.length).toBe(count);
});

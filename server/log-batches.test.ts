import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as streams from '../src/log-streams';

type Batcher = { push(rows: number[]): void; flush(): void; clear(): void };
function create(commit: (rows: number[]) => void) {
  const factory = (streams as unknown as { createLogBatcher?: (commit: (rows: number[]) => void) => Batcher }).createLogBatcher;
  assert.equal(typeof factory, 'function', 'log batching is missing');
  return factory!(commit);
}
test('stream deliveries coalesce into one update every 50ms without losing order', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const updates: number[][] = [];
  const batcher = create(rows => updates.push(rows));
  for (let index = 0; index < 100; index++) batcher.push([index]);
  assert.equal(updates.length, 0);
  t.mock.timers.tick(49);
  assert.equal(updates.length, 0);
  t.mock.timers.tick(1);
  assert.deepEqual(updates, [Array.from({ length: 100 }, (_, i) => i)]);
});
test('clear discards queued records and flush preserves records before freezing or stopping', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const updates: number[][] = [];
  const batcher = create(rows => updates.push(rows));
  batcher.push([1]); batcher.clear();
  t.mock.timers.tick(100);
  assert.deepEqual(updates, []);
  batcher.push([2]); batcher.flush();
  batcher.push([3]); t.mock.timers.tick(50);
  assert.deepEqual(updates, [[2], [3]]);
});

test('queued deliveries remain bounded when timers are throttled', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const updates: number[][] = [];
  const batcher = streams.createLogBatcher<number>(rows => updates.push(rows), {
    capacity: () => 10, compact: (rows, capacity) => rows.slice(-capacity),
  });
  for (let index = 0; index < 1000; index++) batcher.push([index]);
  batcher.flush();
  assert.ok(updates[0]!.length <= 20);
  assert.deepEqual(updates[0]!.slice(-10), Array.from({ length: 10 }, (_, i) => i + 990));
  t.mock.timers.tick(100);
  assert.equal(updates.length, 1);
});

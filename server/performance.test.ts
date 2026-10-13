import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPerformanceMonitor, type PerformanceSample, type PerformanceEnvironment } from '../src/performance';
function harness(supported = true) {
  let now = 0, reads = 0, nextFrame = 0, frameCallback: (() => void) | undefined;
  let sampleCallback: (() => void) | undefined, taskCallback: ((start: number, duration: number) => void) | undefined;
  const samples: PerformanceSample[] = [];
  const env: PerformanceEnvironment = {
    now: () => { reads++; return now; },
    requestFrame: callback => { frameCallback = callback; return ++nextFrame; },
    cancelFrame: () => { frameCallback = undefined; },
    scheduleSample: callback => { sampleCallback = callback; return () => { sampleCallback = undefined; }; },
    observeLongTasks: callback => { if (!supported) return; taskCallback = callback; return () => { taskCallback = undefined; }; },
  };
  const monitor = createPerformanceMonitor(value => samples.push(value), env);
  return { monitor, samples, advance(ms: number) { now += ms; }, frame() { frameCallback?.(); }, sample() { sampleCallback?.(); },
    task(start: number, duration: number) { taskCallback?.(start, duration); }, reads: () => reads,
    scheduled: () => !!frameCallback || !!sampleCallback || !!taskCallback };
}
test('disabled diagnostics do not schedule work or read the clock', () => {
  const h = harness(); assert.equal(h.monitor.measure(() => 42), 42);
  assert.equal(h.reads(), 0); assert.equal(h.scheduled(), false);
});
test('samples elapsed log execution, frame frequency and long tasks over the actual window', () => {
  const h = harness(); h.monitor.start();
  h.monitor.measure(() => h.advance(12));
  assert.throws(() => h.monitor.measure(() => { h.advance(3); throw new Error('work failed'); }));
  for (let i = 0; i < 120; i++) h.frame();
  h.task(10, 70); h.advance(1985); h.sample();
  assert.deepEqual(h.samples[0], { receivedPerSecond: 0, processingMs: 15, framesPerSecond: 60, longTaskCount: 1, longTaskMs: 70, windowMs: 2000 });
  h.advance(1000); h.sample(); assert.equal(h.samples[1]!.processingMs, 0);
  h.monitor.stop(); assert.equal(h.scheduled(), false);
});
test('unsupported long task observation differs from zero and stop/restart drops stale samples', () => {
  const h = harness(false); h.monitor.start(); h.advance(1000); h.sample();
  assert.equal(h.samples[0]!.longTaskCount, null); assert.equal(h.samples[0]!.longTaskMs, null);
  h.monitor.measure(() => h.advance(50)); h.monitor.stop();
  const count = h.samples.length; h.sample(); assert.equal(h.samples.length, count);
  h.monitor.start(); h.advance(1000); h.sample(); assert.equal(h.samples.at(-1)!.processingMs, 0);
});
test('long task reports from before enabling are excluded', () => {
  const h = harness(); h.advance(100); h.monitor.start();
  h.task(0, 200); h.task(101, 55); h.advance(1000); h.sample();
  assert.equal(h.samples[0]!.longTaskCount, 1);
});

test('Vue diagnostics stop on disable, hidden tabs and unmount; visibility restarts a fresh window', async t => {
  const { createRenderer, ref } = await import('vue');
  const { usePerformance } = await import('../src/composables/usePerformance');
  t.mock.timers.enable({ apis: ['setInterval'] });
  const keys = ['document', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame', 'PerformanceObserver'];
  const previous = keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  let now = 0, next = 0, disconnected = 0;
  const frames = new Map<number, () => void>();
  class TestDocument extends EventTarget { hidden = false; }
  const document = new TestDocument();
  class TestObserver {
    static supportedEntryTypes = ['longtask'];
    observe() {}
    disconnect() { disconnected++; }
  }
  const globals = { document, performance: { now: () => now },
    requestAnimationFrame: (callback: () => void) => { frames.set(++next, callback); return next; },
    cancelAnimationFrame: (id: number) => frames.delete(id), PerformanceObserver: TestObserver };
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true });
  const enabled = ref(false);
  let controller!: ReturnType<typeof usePerformance>;
  const renderer = createRenderer<object, object>({
    insert() {}, remove() {}, createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
    setText() {}, setElementText() {}, parentNode: () => null, nextSibling: () => null, patchProp() {},
  });
  const app = renderer.createApp({ setup() { controller = usePerformance(enabled, undefined, true); return () => null; } });
  try {
    app.mount({}); assert.equal(frames.size, 0);
    enabled.value = true; assert.equal(frames.size, 1);
    controller.measure(() => { now += 10; }); now = 1000; t.mock.timers.tick(1000);
    assert.equal(controller.sample.value.processingMs, 10);
    document.hidden = true; document.dispatchEvent(new Event('visibilitychange'));
    assert.equal(frames.size, 0); assert.equal(controller.sample.value.windowMs, 0);
    document.hidden = false; document.dispatchEvent(new Event('visibilitychange'));
    assert.equal(frames.size, 1); now = 2000; t.mock.timers.tick(1000);
    assert.equal(controller.sample.value.processingMs, 0);
    enabled.value = false; assert.equal(frames.size, 0);
    enabled.value = true; assert.equal(frames.size, 1);
    app.unmount(); assert.equal(frames.size, 0); assert.equal(disconnected, 3);
    const releaseApp = renderer.createApp({ setup() {
      controller = usePerformance(ref(true), () => { throw new Error('release must not sample rows'); }, false);
      return () => null;
    } });
    releaseApp.mount({});
    assert.equal(frames.size, 0, 'release never schedules animation sampling');
    controller.received(1000);
    controller.measure(() => { now += 10; });
    t.mock.timers.tick(2000);
    assert.equal(controller.sample.value.windowMs, 0, 'release never publishes a sample');
    releaseApp.unmount();
    assert.equal(disconnected, 3, 'release never creates a long-task observer');
  } finally {
    app.unmount();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
});

test('incoming rate counts captured records over actual elapsed time and resets per window', () => {
  const h = harness();
  const received = (h.monitor as unknown as { received?: (count: number) => void }).received;
  assert.equal(typeof received, 'function', 'incoming log counter is missing');
  received!(100); h.monitor.start(); received!(2000); h.advance(2000); h.sample();
  assert.equal((h.samples[0] as unknown as { receivedPerSecond: number }).receivedPerSecond, 1000);
  h.advance(1000); h.sample();
  assert.equal((h.samples[1] as unknown as { receivedPerSecond: number }).receivedPerSecond, 0);
  h.monitor.stop(); received!(500); h.monitor.start(); h.advance(1000); h.sample();
  assert.equal((h.samples.at(-1) as unknown as { receivedPerSecond: number }).receivedPerSecond, 0);
});

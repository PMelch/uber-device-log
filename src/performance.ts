export interface PerformanceSample {
  receivedPerSecond: number;
  processingMs: number;
  framesPerSecond: number | null;
  longTaskCount: number | null;
  longTaskMs: number | null;
  windowMs: number;
}
export interface PerformanceEnvironment {
  now: () => number;
  requestFrame: (callback: () => void) => number;
  cancelFrame: (id: number) => void;
  scheduleSample: (callback: () => void) => () => void;
  observeLongTasks: (callback: (start: number, duration: number) => void) => (() => void) | undefined;
}
export const emptyPerformanceSample = (): PerformanceSample => ({
  receivedPerSecond: 0, processingMs: 0, framesPerSecond: null, longTaskCount: null, longTaskMs: null, windowMs: 0,
});

/** Elapsed execution durations, not OS CPU accounting. Does no work until started. */
export function createPerformanceMonitor(publish: (sample: PerformanceSample) => void, environment: PerformanceEnvironment) {
  let active = false, frame = 0, started = 0, sampled = 0;
  let received = 0, processing = 0, frames = 0, longTasks = 0, longTime = 0;
  let stopSample: (() => void) | undefined, stopObserver: (() => void) | undefined;
  function reset() { received = 0; processing = 0; frames = 0; longTasks = 0; longTime = 0; }
  function tick() {
    if (!active) return;
    frames++;
    frame = environment.requestFrame(tick);
  }
  function sample() {
    if (!active) return;
    const now = environment.now(), elapsed = now - sampled;
    if (elapsed <= 0) return;
    publish({ receivedPerSecond: received * 1000 / elapsed, processingMs: processing, framesPerSecond: frames * 1000 / elapsed,
      longTaskCount: stopObserver ? longTasks : null, longTaskMs: stopObserver ? longTime : null, windowMs: elapsed });
    reset(); sampled = now;
  }
  return {
    start() {
      if (active) return;
      active = true; reset(); started = sampled = environment.now();
      stopObserver = environment.observeLongTasks((start, duration) => {
        if (active && start >= started) { longTasks++; longTime += duration; }
      });
      frame = environment.requestFrame(tick);
      stopSample = environment.scheduleSample(sample);
    },
    stop() {
      active = false;
      environment.cancelFrame(frame);
      stopSample?.(); stopObserver?.();
      stopSample = undefined; stopObserver = undefined;
      reset(); publish(emptyPerformanceSample());
    },
    received(count: number) { if (active) received += count; },
    measure<T>(work: () => T): T {
      if (!active) return work();
      const before = environment.now();
      try { return work(); }
      finally { processing += environment.now() - before; }
    },
  };
}

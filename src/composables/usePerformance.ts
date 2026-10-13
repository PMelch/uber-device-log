import { onMounted, onUnmounted, shallowRef, watch, type Ref } from 'vue';
import { createPerformanceMonitor, emptyPerformanceSample } from '../performance';

export function usePerformance(enabled: Ref<boolean>) {
  const sample = shallowRef(emptyPerformanceSample());
  let mounted = false;
  const monitor = createPerformanceMonitor(value => { sample.value = value; }, {
    now: () => performance.now(),
    requestFrame: callback => requestAnimationFrame(callback),
    cancelFrame: id => { if (id) cancelAnimationFrame(id); },
    scheduleSample: callback => { const timer = setInterval(callback, 1000); return () => clearInterval(timer); },
    observeLongTasks: callback => {
      if (typeof PerformanceObserver === 'undefined' || !PerformanceObserver.supportedEntryTypes?.includes('longtask')) return;
      try {
        const observer = new PerformanceObserver(list => {
          for (const entry of list.getEntries()) callback(entry.startTime, entry.duration);
        });
        observer.observe({ type: 'longtask' });
        return () => observer.disconnect();
      } catch { return; }
    },
  });
  function sync() {
    if (!mounted) return;
    if (enabled.value && !document.hidden) monitor.start(); else monitor.stop();
  }
  watch(enabled, sync, { flush: 'sync' });
  onMounted(() => { mounted = true; document.addEventListener('visibilitychange', sync); sync(); });
  onUnmounted(() => { mounted = false; document.removeEventListener('visibilitychange', sync); monitor.stop(); });
  return { sample, measure: monitor.measure };
}

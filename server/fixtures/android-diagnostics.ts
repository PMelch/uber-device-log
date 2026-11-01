import type { LogMessage } from '../../shared/types.js';
/** Fictional, source-derived Logcat records. These are not physical-device captures. */
export const androidDiagnosticBundles = ['android-ui-performance', 'android-memory', 'android-stability'];
export const androidDiagnosticIds = ['android-skipped-frames', 'android-slow-frame', 'android-startup', 'android-art-gc', 'android-out-of-memory', 'android-low-memory-kill', 'android-anr', 'android-java-fatal', 'android-native-fatal'];
export function androidLog(message: string, tag: string, pid = 12042): LogMessage {
  return { timestamp: '2026-11-01T12:00:00.000Z', message, tag, pid, level: 'I', source: { key: 'android:fixture', name: 'Fictional Android', platform: 'android', deviceId: 'fixture' } };
}
export const androidDiagnosticCases: { id: string; record: LogMessage; outcome: 'completed' | 'failed'; results: Record<string, string> }[] = [
  { id: 'android-skipped-frames', record: androidLog('Skipped 42 frames!  The application may be doing too much work on its main thread.', 'Choreographer'), outcome: 'completed', results: { skippedFrames: '42' } },
  { id: 'android-slow-frame', record: androidLog('Davey! duration=812ms; Flags=0, IntendedVsync=1000000, Vsync=2000000, FrameCompleted=813000000, ', 'OpenGLRenderer'), outcome: 'completed', results: { durationMs: '812' } },
  { id: 'android-slow-frame', record: androidLog('Davey! duration=945ms; Flags=0, IntendedVsync=1000000, FrameCompleted=946000000, ', 'HWUI'), outcome: 'completed', results: { durationMs: '945' } },
  { id: 'android-startup', record: androidLog('Displayed com.example.game/.MainActivity: +3s534ms', 'ActivityTaskManager', 500), outcome: 'completed', results: { component: 'com.example.game/.MainActivity', firstFrameTime: '3s534ms' } },
  { id: 'android-startup', record: androidLog('Displayed com.example.game/.MainActivity: +534ms (total +1m22s643ms)', 'ActivityManager', 500), outcome: 'completed', results: { firstFrameTime: '534ms', totalTime: '1m22s643ms' } },
  { id: 'android-startup', record: androidLog('Displayed com.example.game/.MainActivity for user 10: +1s205ms', 'ActivityTaskManager', 500), outcome: 'completed', results: { component: 'com.example.game/.MainActivity', userId: '10', firstFrameTime: '1s205ms' } },
  { id: 'android-art-gc', record: androidLog('Background concurrent copying GC freed 148910(6MB) AllocSpace objects, 14(280KB) LOS objects, 49% free, 12MB/24MB, paused 106us,152us total 103.200ms', 'art'), outcome: 'completed', results: { pauses: '106us,152us', totalTime: '103.200ms', freedAllocSpace: '148910(6MB)', heapUsed: '12MB', heapSize: '24MB' } },
  { id: 'android-art-gc', record: androidLog('Explicit concurrent mark compact GC freed 24MB AllocSpace bytes, 0(0B) LOS objects, 49% free, 8MB/16MB, paused 1.200ms,200us total 45.300ms', 'com.example.game'), outcome: 'completed', results: { pauses: '1.200ms,200us', totalTime: '45.300ms', freedAllocSpace: '24MB', heapUsed: '8MB', heapSize: '16MB' } },
  { id: 'android-art-gc', record: androidLog('Background young concurrent copying GC freed 140(24KB) AllocSpace objects, 0(0B) LOS objects, 50% free, 4MB/8MB, paused 0ns total 1.200ms', 'example.game'), outcome: 'completed', results: { pauses: '0ns', totalTime: '1.200ms' } },
  { id: 'android-art-gc', record: androidLog('Alloc concurrent mark compact (sampled) GC freed 24MB AllocSpace bytes, 0(0B) LOS objects, 49% free, 8MB/16MB, paused 1.200ms total 45.300ms', 'example.game'), outcome: 'completed', results: { pauses: '1.200ms', totalTime: '45.300ms' } },
  { id: 'android-out-of-memory', record: androidLog('java.lang.OutOfMemoryError: Failed to allocate a 16777216 byte allocation with 1024 free bytes', 'AndroidRuntime'), outcome: 'failed', results: { detail: 'Failed to allocate a 16777216 byte allocation with 1024 free bytes' } },
  { id: 'android-out-of-memory', record: androidLog('Caused by: java.lang.OutOfMemoryError: Java heap space\n\tat com.example.Buffer.allocate(Buffer.java:42)', 'AndroidRuntime'), outcome: 'failed', results: { detail: 'Java heap space' } },
  { id: 'android-low-memory-kill', record: androidLog("Kill 'com.example.game' (12042), uid 10123, oom_score_adj 900 to free 131072kB rss, 4096kB swap; reason: low watermark is breached and swap is low", 'lowmemorykiller', 321), outcome: 'failed', results: { process: 'com.example.game', affectedPid: '12042', rssKB: '131072', swapKB: '4096' } },
  { id: 'android-low-memory-kill', record: androidLog("Kill 'com.example.game:worker' (12043), uid 10123, oom_score_adj 950 to free 65536kB rss, 0kb swap", 'lowmemorykiller', 321), outcome: 'failed', results: { process: 'com.example.game:worker', affectedPid: '12043', swapKB: '0' } },
  { id: 'android-anr', record: androidLog('ANR in com.example.game (com.example.game/.MainActivity)\nPID: 12042\nReason: Input dispatching timed out\nCPU usage from 0ms to 5000ms later: 70% com.example.game', 'ActivityManager', 500), outcome: 'failed', results: { process: 'com.example.game', affectedPid: '12042', reason: 'Input dispatching timed out' } },
  { id: 'android-anr', record: androidLog('ANR in com.example.game:worker', 'ActivityManager', 500), outcome: 'failed', results: { process: 'com.example.game:worker' } },
  { id: 'android-java-fatal', record: androidLog('FATAL EXCEPTION: main\nProcess: com.example.game, PID: 12042\njava.lang.IllegalStateException: fixture\n\tat com.example.Main.start(Main.java:42)', 'AndroidRuntime'), outcome: 'failed', results: { thread: 'main', process: 'com.example.game', affectedPid: '12042' } },
  { id: 'android-java-fatal', record: androidLog('FATAL EXCEPTION: <img src=x>', 'AndroidRuntime'), outcome: 'failed', results: { thread: '<img src=x>' } },
  { id: 'android-native-fatal', record: androidLog('Fatal signal 11 (SIGSEGV), code 1 (SEGV_MAPERR), fault addr 0x0 in tid 12045 (RenderThread), pid 12042 (com.example.game)', 'libc'), outcome: 'failed', results: { signal: 'SIGSEGV', signalNumber: '11', affectedPid: '12042', tid: '12045' } },
  { id: 'android-native-fatal', record: androidLog('Fatal signal 6 (SIGABRT), code -1 (SI_QUEUE from pid 12042, uid 10123) in tid 12042 (example.game), pid 12042 (example.game)', 'libc'), outcome: 'failed', results: { signal: 'SIGABRT', affectedPid: '12042' } },
];
export const androidDiagnosticNoise = [
  androidLog('Skipped frame due to FPSDivisor', 'Choreographer'),
  androidLog('Skipped 42 frames!', 'ExampleApp'),
  androidLog('Documentation example: Skipped 42 frames!', 'Choreographer'),
  androidLog('Davey! duration=unknownms; Flags=0', 'HWUI'),
  androidLog('Davey! duration=812ms; Flags=0', 'ExampleApp'),
  androidLog('Displayed com.example.game/.MainActivity: +3s534ms', 'ExampleApp'),
  androidLog('Fully drawn com.example.game/.MainActivity: +3s534ms', 'ActivityTaskManager'),
  androidLog('Background concurrent copying GC freed some objects', 'art'),
  androidLog('Example GC freed 24MB AllocSpace bytes, 0(0B) LOS objects, 49% free, 8MB/16MB, paused 1ms total 45ms', 'art'),
  androidLog('No java.lang.OutOfMemoryError was thrown', 'AndroidRuntime'),
  androidLog('java.lang.IllegalStateException: OutOfMemoryError is a fixture name', 'AndroidRuntime'),
  androidLog('OutOfMemoryError', 'ExampleApp'),
  androidLog('Killing 12042:com.example.game/u0a123 (adj 900): remove task', 'ActivityManager'),
  androidLog('Skipping kill; 4096 kB freed elsewhere.', 'lowmemorykiller'),
  androidLog("Kill 'com.example.game' (12042), uid 10123, oom_score_adj 900 to free 131072kB rss, 4096kB swap", 'ExampleApp'),
  androidLog('ANR in com.example.game', 'ExampleApp'),
  androidLog('Reason: Input dispatching timed out', 'ActivityManager'),
  androidLog('No ANR in com.example.game', 'ActivityManager'),
  androidLog('FATAL EXCEPTION: main', 'ExampleApp'),
  androidLog('Process: com.example.game, PID: 12042', 'AndroidRuntime'),
  androidLog('Fatal signal 11 (SIGSEGV)', 'ExampleApp'),
  androidLog('signal 11 (SIGSEGV), code 1 (SEGV_MAPERR)', 'DEBUG'),
];

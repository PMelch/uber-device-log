// Synthetic examples, not real device captures. Format references: docs/crash-format-research.md.
export const androidCrashSamples = [
  { name: 'Java / Kotlin cause chain', tag: 'AndroidRuntime', level: 'E', message: `FATAL EXCEPTION: main
Process: com.example.crashdemo, PID: 8421
java.lang.IllegalStateException: Unable to open the scene
\tat com.example.crashdemo.SceneActivity.onCreate(SceneActivity.kt:48)
Caused by: java.lang.NullPointerException: scene was null
\tat com.example.crashdemo.SceneLoader.load(SceneLoader.kt:91)
\t... 12 more` },
  { name: 'Native SIGSEGV / tombstone excerpt', tag: 'DEBUG', level: 'F', message: `*** *** *** *** *** *** *** *** *** *** *** *** *** *** *** ***
pid: 8421, tid: 8438, name: RenderThread  >>> com.example.crashdemo <<<
signal 11 (SIGSEGV), code 1 (SEGV_MAPERR), fault addr 0x0000000000000010
    x0  0000000000000000  x1  0000007a12001000
    sp  0000007a00fff800  lr  0000007a10001200  pc  0000007a10001100
backtrace:
    #00 pc 0000000000011100  /data/app/com.example.crashdemo/lib/arm64/libscene.so (Scene::render()+32) (BuildId: a1b2c3d4)
    #01 pc 0000000000042200  /apex/com.android.runtime/lib64/bionic/libc.so (__pthread_start(void*)+208)` },
  { name: 'Abort / allocator diagnostic', tag: 'DEBUG', level: 'F', message: `signal 6 (SIGABRT), code -1 (SI_QUEUE), fault addr --------
Abort message: 'Scudo ERROR: invalid chunk state when deallocating address 0x7a10002000'
backtrace:
    #00 pc 0000000000051000  /apex/com.android.runtime/lib64/bionic/libc.so (abort+164)
    #01 pc 0000000000022000  /data/app/com.example.crashdemo/lib/arm64/libscene.so (Scene::dispose()+80)` },
  { name: 'ANR / blocked main thread', tag: 'ActivityManager', level: 'E', message: `ANR in com.example.crashdemo (com.example.crashdemo/.SceneActivity)
PID: 8421
Reason: Input dispatching timed out (application did not respond)
"main" prio=5 tid=1 Blocked
  at com.example.crashdemo.SceneStore.read(SceneStore.kt:73)
  - waiting to lock <0x0123abcd> (a java.lang.Object) held by thread 14` },
  { name: 'Unity managed exception', tag: 'Unity', level: 'E', message: `NullReferenceException: Object reference not set to an instance of an object
Game.SceneController.Update () (at Assets/Scripts/SceneController.cs:64)
UnityEngine.Debug:LogException(Exception)` },
];
export const iosCrashSamples = [
  { name: 'Objective-C exception / console', message: `Sep 30 08:23:10 iPhone CrashDemo[242] <Error>: *** Terminating app due to uncaught exception 'NSRangeException', reason: 'index 3 beyond bounds [0 .. 1]'
*** First throw call stack:
(
0   CoreFoundation  0x0000000180201000 __exceptionPreprocess + 172
1   libobjc.A.dylib  0x0000000180012000 objc_exception_throw + 60
2   CrashDemo  0x0000000100014300 -[SceneController openScene:] + 84 (SceneController.m:37)
)
libc++abi: terminating due to uncaught exception of type NSException` },
  { name: 'Swift runtime trap', message: `CrashDemo/SceneStore.swift:42: Fatal error: Unexpectedly found nil while unwrapping an Optional value
Exception Type: EXC_BREAKPOINT (SIGTRAP)
Thread 0 Crashed:
0   libswiftCore.dylib  0x0000000181000010 _assertionFailure(_:_:file:line:flags:) + 312
1   CrashDemo  0x0000000100014410 SceneStore.load() + 64 (SceneStore.swift:42)` },
  { name: 'Native bad access / text crash report', message: `Exception Type: EXC_BAD_ACCESS (SIGSEGV)
Exception Subtype: KERN_INVALID_ADDRESS at 0x0000000000000010
Termination Reason: Namespace SIGNAL, Code 11 Segmentation fault: 11
Triggered by Thread: 3
Thread 3 Crashed:
0   SceneKit  0x0000000190011000 renderer_draw + 96
1   CrashDemo  0x0000000100032200 SceneRenderer.render() + 48 (SceneRenderer.swift:86)
Thread 3 crashed with ARM Thread State (64-bit):
    x0: 0x0000000000000000   x1: 0x0000000101234000
    pc: 0x0000000190011000   lr: 0x0000000100032200` },
  { name: 'Watchdog termination', message: `Exception Type: EXC_CRASH (SIGKILL)
Termination Reason: Namespace FRONTBOARD, Code 0x8badf00d
Termination Description: scene-update watchdog transgression: com.example.crashdemo exhausted real (wall clock) time allowance
Thread 0 name: Dispatch queue: com.apple.main-thread
Thread 0 Crashed:
0   libsystem_kernel.dylib  0x0000000180100010 semaphore_wait_trap + 8
1   CrashDemo  0x0000000100054000 SceneLoader.waitForAsset() + 72 (SceneLoader.swift:108)` },
  { name: 'Jetsam / memory pressure, not an exception stack', message: `memorystatus: killing process 242 [CrashDemo] (per-process-limit)
JetsamEvent: process CrashDemo [242], reason: per-process-limit, rpages: 98304, pageSize: 16384` },
];
export const ipsSample = '{"bug_type":"309","app_name":"CrashDemo"}\n' + JSON.stringify({
  procName: 'CrashDemo', exception: { type: 'EXC_BAD_ACCESS', signal: 'SIGSEGV', subtype: 'KERN_INVALID_ADDRESS at 0x10' },
  termination: { namespace: 'SIGNAL', code: 11 }, faultingThread: 0,
  threads: [{ triggered: true, frames: [{ imageIndex: 0, imageOffset: 128, symbol: 'SceneRenderer.render()', symbolLocation: 48 }] }],
  usedImages: [{ name: 'CrashDemo', base: 4294967296, size: 65536, uuid: '00000000-0000-0000-0000-000000000001' }],
});

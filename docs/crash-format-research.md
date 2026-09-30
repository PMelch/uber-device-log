# Android and iOS crash formatting

Research and implementation: 30 September 2026. Examples in
`server/fixtures/crash-messages.ts` are synthetic format fixtures, not captured
crashes. Screenshots use those fixtures in the real Vue application.

## Important distinction: formatting is not capture or diagnosis

The formatter classifies text already present in a log record. It does not fetch
crash files, decode binary core dumps, symbolicate addresses, diagnose the root
cause, or promise that every crash reaches the live stream. Unknown/truncated
content stays readable as raw text. Original records remain unchanged for fuzzy
search and full-log Save; selected-text Copy/Save uses the visible selection.
A formatted exception is not proof that the application terminated (caught Java
exceptions and non-fatal resource reports are examples).

## Android

| Family | Typical evidence | Presentation |
| --- | --- | --- |
| Java/Kotlin | `FATAL EXCEPTION:`, exception class, `at method(File.kt:42)`, `Caused by:`, `Suppressed:`, omitted-frame count | Exception/cause in red, source location emphasized, frames indented, cause-chain separator |
| Native C/C++/JNI | `Fatal signal … (SIG…)`, `signal …`, process/thread identity, abort reason, `backtrace:`, `#00 pc … /path/lib.so (symbol+offset)` | Signal on tinted line; reason emphasized; frame index/address muted; library and full symbol preserved |
| SIGSEGV / SIGBUS | Signal code and fault address | Keep the complete address and code; do not claim every bad address is a null dereference |
| SIGABRT / allocator / JNI | `Abort message:`, FORTIFY/Scudo/JNI diagnostics | Highlight the diagnostic separately from the stack; do not infer a memory bug solely from SIGABRT |
| SIGSYS | Signal and seccomp cause | Same signal/cause layout; preserve syscall/architecture data |
| Sanitizers | ASan/HWASan error header, native frames | Emphasize detector output; retain original details and unknown continuation lines |
| ANR | `ANR in`, timeout reason, named Java threads, lock-wait lines | Warning/reason and blue thread/lock sections; not labelled a native crash |
| Unity managed | Exception plus `Namespace.Method () (at Assets/File.cs:64)` | Exception and C# source location; IL2CPP native frames follow native rules |

AOSP documents native crash diagnostics in logcat and more detailed tombstones.
A tombstone is a structured textual diagnostic (and on newer systems may have a
protobuf representation), not interchangeable with an arbitrary ELF core dump.
The current binary-logcat decoder decodes the log transport, **not a core dump**.
Full tombstone access is device/permission dependent. Native symbolication needs
matching unstripped libraries/build information; formatting alone cannot recover
source names from addresses.

The existing `logcat -B *:V` capture uses default buffers (main/system/crash per the
logcat documentation). No new all-buffer switch is required for this formatter.
ANR traces, tombstone files and binary/core/kernel dumps are not automatically
retrieved by this application.

Sources:
- [AOSP: Diagnose native crashes](https://source.android.com/docs/core/tests/debug/native-crash)
- [Android: Logcat buffers](https://developer.android.com/tools/logcat)
- [Android NDK: ndk-stack and required symbols](https://developer.android.com/ndk/guides/ndk-stack)
- [Android: ANRs](https://developer.android.com/topic/performance/issues/anr)
- [Android NDK: native tombstone access](https://developer.android.com/ndk/guides/debug)

## iOS

| Family | Typical evidence | Presentation |
| --- | --- | --- |
| Objective-C/C++ exception | Uncaught-exception diagnostic, reason, first-throw/last-exception stack, `libc++abi` termination | Exception/diagnostic emphasized; numbered image/address/symbol frames separated visually |
| Swift runtime failure | `.swift:line: Fatal error:`, often EXC_BREAKPOINT/SIGTRAP on ARM | Source diagnostic in red; distinguish from ordinary recoverable `throws` errors |
| Native memory fault | `Exception Type: EXC_BAD_ACCESS`, SIGSEGV/SIGBUS, subtype, crashed thread | Exception type emphasized, subtype visible, blue thread section, native stack |
| Watchdog | Termination reason with `0x8badf00d`, timeout description | Termination and explanatory text highlighted; keep thread state, do not invent a thrown exception |
| Jetsam / memory pressure | System kill diagnostic or memory report, per-process-limit/reason/page data | Memory diagnostic, not a fake exception stack; retain process and memory measurements |
| EXC_RESOURCE / EXC_GUARD | Exception type, subtype/message/note | Same report-field styling; `NON-FATAL CONDITION` remains visible and must not be interpreted as proof of termination |
| Modern IPS JSON | Optional metadata JSON line followed by report JSON; exception/termination, threads/frames, usedImages | Indent recognized complete report JSON, highlight important keys and signal values; retain every original numeric/string token |

Apple's crash reports separate Mach exception information from language-exception
backtraces. Jetsam reports describe memory/process state and do not provide the
same thread backtraces as normal crash reports. Watchdog stacks show what threads
were doing when terminated, which is not necessarily the work that consumed the
whole timeout. Symbolication requires matching symbols/dSYM data.

**Collector limitation:** `server/devices.ts` uses Appium's legacy
`com.apple.syslog_relay`. Text may include console envelopes and split records;
those envelopes remain visible. This is not a complete unified-log/crash-report
collector. Full `.ips`/jetsam reports are not fetched by this implementation, and
there is no report-file importer yet. JSON formatting is available if a complete
recognized payload is supplied as a message. Malformed/truncated reports stay raw.
The existing upstream line-size and server-record limits still apply.

Sources:
- [Apple: Identifying common crashes](https://developer.apple.com/documentation/xcode/identifying-the-cause-of-common-crashes)
- [Apple: Exception types](https://developer.apple.com/documentation/xcode/understanding-the-exception-types-in-a-crash-report)
- [Apple: IPS JSON schema](https://developer.apple.com/documentation/xcode/interpreting-the-json-format-of-a-crash-report)
- [Apple: Watchdog terminations](https://developer.apple.com/documentation/xcode/addressing-watchdog-terminations)
- [Apple: Jetsam reports](https://developer.apple.com/documentation/xcode/identifying-high-memory-use-with-jetsam-event-reports)
- [Apple: EXC_RESOURCE and nonfatal reports](https://developer.apple.com/documentation/xcode/exc_resource)
- [Apple: Symbolication](https://developer.apple.com/documentation/xcode/adding-identifiable-symbol-names-to-a-crash-report)
- [Appium syslog service source](https://github.com/appium/appium-ios-device/blob/master/lib/syslog/index.js)

## Implementation and verification

`parseLogStack` extends the existing presentation-only Java formatter. High-confidence
line syntax classifies independently delivered native/iOS frames as well as
multiline messages. It does **not** join records across process IDs or reverse the
internal lines of a message when newest-first order is selected. Separate stream
records retain the user's selected ordering. Unknown lines inside a known report
remain visible.

Vue renders text, never log-controlled HTML. Ordinary JSON is not treated as a
crash report. IPS validation checks an exception/threads shape (or a jetsam
memoryStatus/processes shape); metadata-only or incomplete input stays raw.
Pretty-printing changes whitespace only, so large numeric addresses do not get
rounded. Nesting and input-size bounds avoid uncontrolled formatting expansion.

Tests cover format families, split records, prefix preservation, raw exports,
ordinary-message false positives, HTML escaping, source locations, malformed JSON,
64-bit literals and excessive nesting. Synthetic browser replay checks actual
layout for Android and iOS. Physical-device capture, symbolication, binary core
dump decoding and 100,000-row performance are not validated here.

## Follow-up work for complete incident support

1. Add explicit local `.ips`/text tombstone import with original-file export and
   separate metadata, crashed-thread and raw-data views.
2. Add authorized crash-report retrieval alongside—not disguised as—the live
   syslog/logcat stream; expose capture gaps to users.
3. Add optional symbolication with exact build IDs and matching user-provided
   symbols. Never label guessed frames as symbolicated.
4. If incident grouping is added, retain PID/TID, time and stream boundaries;
   never merge neighboring unrelated crash text just because severity matches.

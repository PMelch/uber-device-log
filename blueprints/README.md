# Android diagnostic Blueprint bundles

These opt-in bundles recognize existing Android Logcat records. They require no application logging changes, SDK, injected JavaScript or new collector. Use a viewer implementing [Blueprint bundles](../docs/blueprint-bundles.md) and the current version 1 DSL. A package version in this repository does not establish publication or compatibility of an older installed viewer.

| Bundle | Definitions | Download |
| --- | --- | --- |
| [Android UI performance](android-ui-performance/config.yaml) | Choreographer skipped frames, slow HWUI frames, first-frame startup | [android-ui-performance.blueprint](bundles/android-ui-performance.blueprint) |
| [Android memory diagnostics](android-memory/config.yaml) | ART collection, Java allocation failure, low-memory kill | [android-memory.blueprint](bundles/android-memory.blueprint) |
| [Android stability diagnostics](android-stability/config.yaml) | ANR header, Java fatal-exception header, native fatal-signal header | [android-stability.blueprint](bundles/android-stability.blueprint) |

Source YAML is stored in the corresponding directories; their required `config.yaml` files include an ID, name, description and `specVersion: 1`. Every other root YAML file is discovered automatically. These directories are a distribution library, not an active `.udl/flows` directory. Merely checking out this repository does not load or install them. Names, descriptions, labels and result field names are authored technical data in English, shown verbatim like other Blueprints; application controls and outcome badges retain their selected UI language.

## Install and enable

1. Download a `.blueprint` archive from the table above. On GitHub's file page, use **Download raw file**, or use the [direct Android UI performance download](https://raw.githubusercontent.com/PMelch/uber-device-log/main/blueprints/bundles/android-ui-performance.blueprint).
2. In **Flows → Blueprint sources**, expand **Install a bundle**, set **Install from** to **Local file**, and choose the downloaded archive.
3. Choose **Global** or **Project**, then **Validate and install**. Project installation requires launching the viewer with `--project` or `--flows`.
4. Enable the installed bundle to start recognition. Installation alone leaves it disabled. Repeat for the memory or stability bundle as needed.

You can also select **Bundle URL** and paste a direct HTTP(S) URL to an archive. A GitHub file-view page is not a raw archive URL. No temporary server is needed for local files.

From a source checkout, after `npm run build`, install an archive directly:

```sh
node bin/uber-device-log.mjs install-blueprint ./blueprints/bundles/android-ui-performance.blueprint --project /path/to/application
# Alternatively, install for the user home:
node bin/uber-device-log.mjs install-blueprint ./blueprints/bundles/android-ui-performance.blueprint --global
```

With an installed CLI that supports bundle files, use `udl install-blueprint "/path/to/downloads/android-ui-performance.blueprint" --global`. Quote paths containing spaces. The CLI exits after installation; enable the bundle in the viewer afterward.

Include the native **Device logs** source when capturing Android. Global/project activation and conflicting Blueprint IDs follow the [bundle guide](../docs/blueprint-bundles.md). System-service records concern whichever process/component their text identifies, potentially another app on the device.

## Meaning and limits

Each match is an independent, immediately terminal one-record observation. The DSL still requires `correlation.primary`, so each definition extracts the first message line into the internal `record` field. This field is not a unique incident ID or a bridge to later evidence. Repeated identical records produce separate entries, including in one ingest batch. The required `timeout: 1s` is a format placeholder; these definitions never wait for another step.

`completed` means the diagnostic observation was recognized, not that the app recovered or performed successfully. Scheduling-delay and slow-frame labels use the warning tone; GC and startup labels are informational. `failed` marks an observed error/ANR/fatal report or low-memory kill; exception reports alone do not prove a process exited. None of these Blueprints merges records into a crash incident, sums rates or calculates numeric alert thresholds. A multiline fatal report containing OutOfMemoryError can correctly produce both the Java-fatal and allocation-failure diagnoses.

| Blueprint ID | Accepted evidence and extracted results | Interpretation limit |
| --- | --- | --- |
| `android-skipped-frames` | Exact Choreographer message, `skippedFrames` | Scheduling-delay report; not an FPS sample or proof that CPU/GC caused it. |
| `android-slow-frame` | Davey duration under `OpenGLRenderer` or `HWUI`, `durationMs` | Selected slow-frame reports, not every rendered frame. |
| `android-startup` | Displayed component under `ActivityManager`/`ActivityTaskManager`, `firstFrameTime`, optional `totalTime`/`userId` | First frame (TTID), not fully loaded app/WebView. Handles legacy and `for user` shapes. |
| `android-art-gc` | Selected concurrent copying/mark-compact/mark-sweep forms, including young/partial/sticky and sampled variants; collector, freed AllocSpace, free percent, heap usage, pauses and total time | Total duration is not the stop-the-world pause. Only logged collections are visible. No leak, allocation-rate or jank-cause inference. |
| `android-out-of-memory` | AndroidRuntime exception/cause line in a single or multiline record; optional detail | Reported Java allocation failure; no automatic leak or kill diagnosis. |
| `android-low-memory-kill` | AOSP `lowmemorykiller` kill record; process, affected PID, UID, adjustment score, RSS/swap in kB, optional reason (both logged `kB` and `kb` swap spellings) | Victim may be a normal cached app, not the cause of global pressure. Ordinary lifecycle kills do not match. |
| `android-anr` | ActivityManager ANR header; process and optional affected PID/reason in the same record | No CPU/lock/Binder/I/O cause inference; does not turn an isolated Reason line into an ANR. |
| `android-java-fatal` | AndroidRuntime fatal-exception header; thread and optional process/PID in the same record | A custom exception handler may keep the process alive. |
| `android-native-fatal` | libc debuggerd fatal-signal header; signal number/name, thread ID and affected PID | No tombstone reconstruction or assumption that an arbitrary signal means OOM. |

Except for ART's variable logger tag, definitions constrain the originating tag as well as native Android source and the emitted text shape. ART tags differ between releases/processes, so its matcher constrains the full collection text instead. No rule matches generic WARN/ERROR levels. Message formats are not stable Android APIs: OEM changes, suppressed messages and unsupported shapes remain unrecognized. This is code-derived coverage with synthetic regression fixtures; no physical-device/OEM coverage is claimed.

The Logcat PID is the *logger's* PID. For ANR, startup and LMKD records that is normally a system service/daemon. The affected PID is only shown when explicitly extracted from the message; split following lines are never joined by timing. Fields retain their logged units and string representation. Original evidence, timestamps and logs are unchanged. Application/native heap GC and WebView JavaScript GC are different systems; these ART rules do not observe V8 or JavaScriptCore collections.

## Source evidence

Reviewed 2026-11-01 against AOSP sources. Baseline viewer: `105b186`. Source repositories and pinned revisions:

- frameworks/base: `1cdfff555f4a21f71ccc978290e2e212e2f8b168`.
- art: `6484611fd45e69db9f33f98bfd6864014b030ecf`.
- system/memory/lmkd: `767ae2336a12f0c474b19dbd86d5bd5164dbf912`.
- system/core: `a3b721a32242006b59cb12bd62c9133632af3a2d`.

| Definition | Emitter / reference |
| --- | --- |
| Skipped frames | [Choreographer.doFrame](https://android.googlesource.com/platform/frameworks/base/+/1cdfff555f4a21f71ccc978290e2e212e2f8b168/core/java/android/view/Choreographer.java): guarded scheduling warning; default threshold is configurable. |
| Slow HWUI frame | [JankTracker](https://android.googlesource.com/platform/frameworks/base/+/1cdfff555f4a21f71ccc978290e2e212e2f8b168/libs/hwui/JankTracker.cpp): Davey duration and frame fields. |
| Startup | [ActivityMetricsLogger.logAppDisplayed](https://android.googlesource.com/platform/frameworks/base/+/1cdfff555f4a21f71ccc978290e2e212e2f8b168/services/core/java/com/android/server/wm/ActivityMetricsLogger.java) and [Android startup guide](https://developer.android.com/topic/performance/issues/launch-time): current user-ID form and documented legacy/total form. |
| ART collection and allocation failure | [Heap::LogGC / ThrowOutOfMemoryError](https://android.googlesource.com/platform/art/+/6484611fd45e69db9f33f98bfd6864014b030ecf/runtime/gc/heap.cc); [Android 10 Heap::LogGC](https://android.googlesource.com/platform/art/+/refs/tags/android-10.0.0_r1/runtime/gc/heap.cc) for the earlier AllocSpace-object-count shape. |
| Low-memory kill | [lmkd kill_one_process](https://android.googlesource.com/platform/system/memory/lmkd/+/767ae2336a12f0c474b19dbd86d5bd5164dbf912/lmkd.cpp): successful kill record, including explicit victim PID. |
| ANR | [ProcessErrorStateRecord.appNotResponding](https://android.googlesource.com/platform/frameworks/base/+/1cdfff555f4a21f71ccc978290e2e212e2f8b168/services/core/java/com/android/server/am/ProcessErrorStateRecord.java): header, PID and optional annotation. |
| Java fatal exception | [RuntimeInit.logUncaught](https://android.googlesource.com/platform/frameworks/base/+/1cdfff555f4a21f71ccc978290e2e212e2f8b168/core/java/com/android/internal/os/RuntimeInit.java): header, process and PID; documents the custom-handler caveat. |
| Native fatal signal | [debuggerd handler](https://android.googlesource.com/platform/system/core/+/a3b721a32242006b59cb12bd62c9133632af3a2d/debuggerd/handler/debuggerd_handler.cpp): fatal libc header with optional fault address/syscall and explicit thread/process IDs. |

These are selected emitter shapes, not a claim to cover every historical Android version. These Blueprints do not poll CPU/memory, enable StrictMode, change device log properties, import ANR traces or add WebView performance capture.

## Rebuild and test

From the viewer checkout with development dependencies installed:

```sh
npm run blueprints:build
npm run blueprints:check
node --import tsx --test server/android-diagnostics.test.ts
npm test
npm run build
node --import tsx scripts/test-android-diagnostics.mjs
```

The builder uses deterministic stored ZIP entries and validates every archive before writing it. `--check` detects source/archive drift without writing files. The fixture in `server/fixtures/android-diagnostics.ts` contains fictional source-derived records and explicit expected values, not captured device logs. Tests cover accepted variants, repeats/batching/devices, wrong platform/source/tag, near-miss noise, unchanged evidence, archive drift and real installation/activation into temporary homes/projects. The browser fixture serves the production build, installs the archives through the API and sends records through SSE/worker analysis; it checks terminal outcomes, result/evidence display, escaping, keyboard access, all seven UI languages, all three display modes and desktop/mobile light/dark layouts. Use the Playwright/browser overrides from the [browser regression guide](../docs/semantic-flows-browser-tests.md).

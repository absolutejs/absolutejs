# Android startup investigation — 2026-09-19

## Current conclusion

The disposable API 36 emulator can fail before AbsoluteJS applications are
installed. Captured evidence supports CPU scheduling pressure during System UI
initialization, but does **not** establish the host-side cause or a reliable fix.
Keep emulator defaults, ANR rejection, CPU-settling checks, and the framework
publication hold unchanged. A readiness pass is not authenticated native acceptance.

The initial analysis used saved evidence only. The subsequent controlled checks
below ran during an explicitly approved pause window. No host settings changed.

## Controlled checks and post-failure trace

Executed September 19 local time (September 20 UTC). Both independent cold-boot
copies were made from the same stopped synthetic source. All copied files were
SHA-256 verified against the source; all six disk layers were checked for backing
dependencies; the source was rehashed afterward and remained unchanged. No hard
links, snapshots, or source lock/launch files were copied. Both trials used host
graphics, default Vulkan, four guest cores, and 3072 MB RAM. No apps were installed.

| Observation | Trial 1 | Trial 2 |
| --- | --- | --- |
| Clone/observation UUID | `9b8bbe04-f5e7-4e0a-8d16-a05ed21cf22d` | `82ef3f1c-fc3d-4f4d-b24d-fa1544a972f3` |
| Readiness-run UUID | `2baff0a1-17ae-4607-a951-0a50fe9d8b99` | `330eb04a-f1ef-4bc5-9758-9713d911c993` |
| Boot completion | 194,730 ms | 176,616 ms |
| Startup outcome before additional tracing | System UI and other system-service ANRs | System UI and other system-service ANRs |
| Harness outcome | CPU-settling failure | CPU-settling failure (later readings include additional tracing) |

The matched observation period used the same sampler. In Trial 1, samples
`guest-25.json` through `guest-36.json` observed the same System UI PID (1340)
over approximately 69 seconds: runtime increased from 0.09 to 7.45 seconds and
runqueue wait from 0.11 to 45.00 seconds. This is interval evidence of scheduler
pressure, rather than relying only on a cumulative ANR counter. Its first captured
System UI ANR was a 20,205 ms SystemUIService execution timeout.

Both trials reproduced startup ANRs **before** a separate 20-second Perfetto
capture was added to Trial 2. The capture is diagnostic work, not part of the
matched comparison. Do not compare Trial 2's final CPU samples or total test
duration as if instrumentation remained identical throughout.

### Post-failure scheduler trace

Local artifact: Trial 2's `observation/post-anr.pftrace` (2,734,544 bytes).
It was collected with `sched freq idle` on the synthetic guest only, with a
16 MB buffer and 20-second duration limit. No host-wide trace or upload occurred.
The trace contains approximately 18.23 seconds of observed scheduling data.

Offline analysis with official Perfetto Trace Processor v58.2 found:

- Guest CPUs 0–3 were non-idle for approximately 17.90, 17.90, 17.79, and 16.40
  seconds respectively in that observed window.
- `system_server` accumulated 22.27 CPU-seconds across threads; the sensor HAL
  5.33, Google keyboard 5.04, persistent Google services 4.70, and `kworker/3:1`
  4.01. Process CPU time can exceed elapsed time on a multicore guest.
- System UI's main thread was mostly sleeping by this later capture (14.87
  seconds), with 2.21 seconds runnable/preempted and 0.30 seconds running.
  This trace therefore describes continued system load after the ANR, not the
  exact initialization interval that caused it.
- No positive error/data-loss-severity statistics were reported, but there were
  18 ftrace setup notices and two informational tokenizer errors. Do not assume
  every requested event or frequency source was available.

The binary SHA-256 matched the official download manifest:
`58042408e6cc861fb1a731c26bb082dc222285561eaa4e12a48a8b2b90dca7b9`.
See [Perfetto's Android tracing guidance](https://perfetto.dev/docs/learning-more/android)
and [local command-line analysis](https://perfetto.dev/docs/getting-started/command-line-analysis).

### Limits and next action

Early guest pressure reads were permission-denied until the harness enabled
root; those are missing data. The host process sampler matched the windowed
QEMU name, missing `qemu-system-x86_64-headless`; empty process arrays are not
zero CPU usage. Aggregate/per-core host samples were still collected. The local
sampler and source-process check were corrected afterward to include headless
QEMU; the corrected sampler has not been rerun. These limitations do not invalidate
the captured ANRs, but prevent a host scheduling diagnosis.

The early-start guest scheduling trace described below now covers System UI
creation. Neither trace justifies disabling sensors, Google services, or changing
affinity. Only consider a separately approved Windows scheduling trace if guest
evidence cannot distinguish guest work from host/hypervisor delays.

After both trials, the disposable emulator was stopped and the normal
`AbsoluteJS_API_36` emulator was restored with `sys.boot_completed=1` verified.
Raw artifacts and temporary copies were retained locally for investigation.
Framework publication remains held; no authenticated native acceptance passed.

## Early-start trace: initialization interval captured

Three additional diagnostic boots used fresh hash-verified copies of the
preserved source during the approved overnight pause. Preserve all outcomes:

| Observation UUID | Readiness-run UUID | Outcome |
| --- | --- | --- |
| `fd0bdf23-fe67-4a58-b6af-2a6ab24ddddf` | `f8adf429-f7a1-4425-85ce-274b50de08ae` | All 12 UI snapshots passed; trace was empty and unusable |
| `5828751e-b738-468a-9743-97363db1de66` | `0791def6-e1fd-4f00-b186-e8e4eef028be` | CPU-settling failure; circular trace buffer dropped initialization |
| `c4f13b0f-d90c-4c86-89a8-3619da945d27` | `46fe6d1b-3966-4643-b594-aa7ce02cd867` | CPU-settling failure and System UI ANR; initialization trace retained |

The passing boot confirms intermittency, not a fix. Instrumentation changed
between these diagnostic attempts; they are not a matched performance comparison.

### Capture corrections

The first attempt accepted a background process launch and successful file
transfer, but the file had zero bytes. Subsequent attempts established root
before tracing (avoiding the harness's later ADB root restart), used
`--background-wait`, and checked the actual tracing session and file contents.
These changes do not establish which factor caused the original empty file.

The second attempt started successfully but its circular buffer retained only
guest seconds 162.10–246.51, losing initialization and process identity metadata.
The final capture periodically wrote buffers to disk every five seconds, with
a three-minute duration limit and 96 MiB file cap. It selected scheduler and
process events, `am`/`ss` timing categories, and System UI app markers, plus
periodic process metadata. Root and tracing changes affected only the disposable
synthetic guest; no Windows-wide tracing, authenticated data, or uploads occurred.

See [Perfetto's periodic file-writing configuration](https://perfetto.dev/docs/concepts/config)
and [System UI's app-tagged initialization markers](https://android.googlesource.com/platform/frameworks/base/+/0057e7b993f9/packages/SystemUI/src/com/android/systemui/SystemUIApplication.java).

### Validated failing interval

Final local artifact: `observation/early-startup.pftrace` in the third observation
directory above (approximately 26.7 MB). SHA-256:
`db29d86d5d01d20f9d4b691af1cb1788b5acbfa77c287259cff9c893682ff39c`.

The trace spans guest seconds 94.00–273.57. System UI PID 1355 was created at
163.06 seconds; the complete `StartServices` span begins at 171.406122 and lasts
24.463235 seconds. Clipping scheduler states to that exact span yields:

| Main-thread state | Seconds |
| --- | --- |
| Running on CPU | 2.528187 |
| Runnable, waiting for CPU (`R` and `R+`) | 15.091983 |
| Sleeping (`S`) | 6.746572 |
| Uninterruptible wait (`D`) | 0.096494 |

The states account for the full span within rounding precision. All four guest
CPUs were non-idle for 23.22–23.72 seconds of the same 24.46-second interval.
Across their threads, `system_server` consumed 23.88 CPU-seconds, SurfaceFlinger
13.39, the launcher 10.01, and System UI 5.96. These process totals are multicore
CPU time, not elapsed durations and not time exclusively blocking System UI.

The longest named startable, `CentralSurfaces`, lasted 4.99 seconds but used
only 0.28 seconds on the main thread and spent 2.51 seconds runnable.
`SystemActions` lasted 3.50 seconds, with 0.80 seconds running and 2.34 runnable.
This supports a shared scheduling bottleneck; wall duration alone would wrongly
suggest those components performed that much CPU work. Sleeping time remains
unexplained by these scheduler totals and must not be relabeled as CPU starvation.

No positive data-loss, dropped-event, overwrite, or overrun statistics were
reported in the analyzed trace. Trace Processor flagged
`config_write_into_file_no_flush`: the omitted `flush_period_ms` requires loading
the whole trace into analysis memory. This is not an event-loss diagnosis. The
local configuration now adds a five-second flush period for future captures;
the original captured configuration is preserved and has not been retroactively
changed or rerun.

### Conclusion and next decision

We now have direct interval evidence: roughly 62% of the failing initialization
was spent runnable but unscheduled, versus roughly 10% actually running. This is
an Android system-wide responsiveness problem before any AbsoluteJS app install,
not evidence that AbsoluteJS application initialization took 24 seconds of CPU.

The trace does **not** identify whether guest workload, graphics/driver overhead,
or host/hypervisor scheduling is the underlying cause. A targeted kernel/host
profiling step is needed to distinguish them before selecting a remedy. Do not
disable services, change affinity/power plans, or weaken readiness requirements
based only on the aggregate rankings. Windows-wide scheduling capture still
needs separate agreement about unrelated process metadata and local retention.

All three runs were cleaned up; the normal emulator was restored and its boot
completion verified. The pause window was released. Raw traces, invalid-capture
sidecars, SQL analysis scripts, and disposable copies remain local. The framework
release remains held pending authenticated installed-device acceptance.

## Kernel-only startup profile: HPET hotspot

The next independent, hash-verified copy reproduced the failure with a bounded
kernel-only CPU profile. Local observation directory:
`cc371698-a357-4dbb-ad53-0f25ac2a619b/observation`; test log prefix:
`release-data-retry-1789873747489`. The source remained unchanged during cloning.
The readiness test failed its unchanged CPU-settling guard. No application was
installed, no authenticated data was captured, and no host settings were changed.

Perfetto v49 used `linux.perf`, `SW_CPU_CLOCK`, 49 Hz per guest CPU,
`kernel_frames: true`, and `user_frames: UNWIND_SKIP`, alongside the earlier
scheduler/process configuration. Capture duration was 180 seconds, with periodic
file writes and flushes and a 96 MiB cap. Existing guest permissions sufficed;
neither perf permissions nor kernel pointer restrictions were weakened.
These fields are supported by the
[v49 profiling configuration](https://github.com/google/perfetto/blob/v49.0/protos/perfetto/config/profiling/perf_event_config.proto).

The 28,074,696-byte trace has SHA-256
`6a67a47b7eb62e9d14375359d7a7d16ec148fde5f9b0efdff58f38f84bc219f2`.
It contains 35,252 samples with resolved kernel function names and no positive
parser-error or data-loss statistics. Its guest-time bounds are 84.885367–264.723197
seconds, covering System UI PID 1357 creation at 155.614682 seconds and its full
20.833567-second `StartServices` interval beginning at 163.816347 seconds.

During that initialization, the main thread spent 2.615905 seconds running,
11.272235 runnable, 6.821063 sleeping, and 0.124365 in uninterruptible wait.
Each guest CPU was non-idle for approximately 20 of the interval's 20.83 seconds.
Of 4,084 CPU samples in the interval, 3,521 were in kernel mode and 563 in user
mode. The sampled leaf was `read_hpet` in 1,552 samples (38.0% of all samples);
1,668 samples included it anywhere in the stack. These are statistical sample
shares, not exact elapsed CPU-time measurements. The inclusive call paths also
show frequent `clock_gettime`/monotonic-clock reads. Other leaf hotspots included
spin-unlock/interrupt restoration, task switching, and `goldfish_pipe_read_write`.

Read-only guest inspection established:

- Current and available clocksource were both `hpet` (no available `tsc`).
- Boot logs reported TSC adjustment compensation and a cross-CPU synchronization
  failure, then `Marking TSC unstable due to check_tsc_sync_source failed` and a
  switch to HPET.
- The guest command line included `clocksource=pit`; this was observed, not added
  by this experiment. Its provenance and interaction with the fallback need
  investigation before changing launch configuration.

This is a concrete timekeeping hotspot and confirmed clock fallback, **not yet
proof of the upstream cause or a validated fix**. Guest profiling alone cannot
separate emulated timer/MMIO costs from host descheduling during those operations.
Do not force `tsc=reliable`, disable clock validation, or assume the rejected
clock is safe. Linux's
[virtualized x86 timekeeping documentation](https://docs.kernel.org/virt/kvm/x86/timekeeping.html)
explains why clock stability and synchronization matter under virtualization.

Next, inspect the installed emulator's WHPX launch/CPU/TSC handling and upstream
fixes, including the source of `clocksource=pit`. Select a supported candidate
only after that inspection, then compare independent equivalent baseline and
candidate copies with identical instrumentation. Verify clock stability as well
as startup time, CPU pressure, and all readiness checks; a faster boot alone is
not acceptance. Windows-wide tracing or host changes still need separate scope
approval. Authenticated Capacitor/Expo acceptance and framework publication remain
held. The test guest was stopped, and normal emulator identity and
`sys.boot_completed=1` were verified before releasing the user's CPU pause.

## Evidence

Both runs used emulator 37.1.11, Windows/WHPX, API 36 Google APIs x86_64,
NVIDIA host rendering, four guest cores, and 3072 MB guest RAM.

| Observation | Default Vulkan | Vulkan disabled |
| --- | --- | --- |
| Evidence directory UUID | `3ce1e6d5-7c72-45c9-86a7-c0ac6ba39173` | `572e2933-13a7-459a-be27-213d489368c7` |
| Boot completion | 42,983 ms | 78,956 ms |
| CPU-pressure samples | 29 | 36 (limit reached) |
| Peak `some avg10` | 89.34 | 90.91 |
| Final three `some avg10` readings | 18.78, 11.48, 7.32 | 28.29, 35.43, 45.90 |
| Result | All 12 UI snapshots passed | CPU-settling failure; startup ANR captured |

Local artifacts are under `.absolutejs/release-data-conformance/<UUID>/`.
The failing run's `systemui-anr.txt` records:

- KeyguardService execution timeout: 20,004 ms.
- System UI main thread: runnable, executing System UI initialization code.
- `schedstat`: 3,950,130,870 ns runtime, 20,042,042,445 ns runqueue wait,
  2,864 timeslices. These are cumulative counters, not timeout-window deltas.
- No swap for the captured System UI process (`VmSwapKb: 0`).

The separately saved `.absolutejs/no-vulkan-1789868606684-late-boot.log`
contains the ANR-time system report: CPU pressure `some avg10=78.87`, memory
pressure `some avg10=0.01`, and I/O pressure `some avg10=7.44`. Its preceding
approximately 30-second CPU window reports 94% total utilization, including 80%
kernel time and 0.5% I/O wait. `system_server` and SurfaceFlinger are prominent
consumers. This makes CPU/scheduling investigation a stronger next step than
blindly increasing guest RAM. It does not exclude host memory, storage, graphics
driver, hypervisor, or power-management effects.

## Important confound: reused does not mean identical

The default-Vulkan startup log reports no `settings_config.xml` and zero flag
override requests. The subsequent Vulkan-disabled boot logs 1,778 invalid flag
override errors over approximately 0.77 seconds. Both runs reused the same
writable disposable AVD, so its persisted state changed between them.

This is evidence of a comparison confound, **not** proof those errors caused
the 20-second ANR. Raw log counts also cover different time windows and are not
comparable logging rates. Neither the graphics flag nor the settings messages
can be assigned causality from these two runs.

Likewise, isolated host CPU readings of 65% and 54% were not synchronized with
the ANR interval. They cannot rule out host scheduling contention. Guest
runqueue wait alone does not prove Windows placed emulator threads on slow cores.

## Next bounded experiment

### Read-only clone preflight

The selected local source is the stopped `AbsoluteJS_Release_Data_Proof` AVD
referenced by the failing run above. At inspection, Windows reported only the
normal `AbsoluteJS_API_36` QEMU process. Recheck process identity immediately
before copying; this observation is not a persistent guarantee of inactivity.

`qemu-img info --output=json` reports clean (not dirty, not corrupt) headers
for these three overlays, each with a relative sibling backing filename:

| Overlay | Backing file | Backing format |
| --- | --- | --- |
| `userdata-qemu.img.qcow2` | `userdata-qemu.img` | qcow2 |
| `cache.img.qcow2` | `cache.img` | raw |
| `encryptionkey.img.qcow2` | `encryptionkey.img` | raw |

Inspection of all three backing files found no further backing dependencies.
Copy both layers of each pair, never just the overlays. Recheck the backing
files before copying, and verify each
copied chain resolves within its destination. Header metadata alone is not
a full disk-integrity check. Hash source and destination files and verify the
source stayed unchanged during preparation. Do not use hard links.

The actual userdata virtual size is **6 GiB**, although the harness rewrites
`disk.dataPartition.size=4G`. Changing that configuration did not establish a
4 GiB disk for reused state. Keep the real disk size identical across trials
and include it in evidence; do not resize the source as part of this comparison.

The source also contains approximately 3.1 GiB of snapshots and a remaining
`multiinstance.lock` file. Lock-file existence alone does not prove a running
process. Do not remove source locks or snapshots. Prepare cold-boot copies
without snapshots, locks, or generated launch/hardware path files; preserve
required guest state and regenerate destination-specific AVD registration.
At inspection the Windows volume had approximately 66 GiB free; recheck before
copying. No clone, hash sweep, or startup was performed during this preflight.

### Execution checklist

Coordinate a pause window before running this; do not interrupt other sessions.

1. Preserve the existing evidence. Stop and identity-check only the owned
   disposable AVD before copying any disk state. Never clone a live guest disk.
2. Prepare a stopped, synthetic initialized baseline and independent copies for
   every trial. Record the source identity and disk hashes before launch; do not
   reuse a trial's modified userdata for the next trial. Keep cold-boot/snapshot
   policy, graphics, core count, RAM, image, and capture overhead identical.
3. First repeat the **default** configuration from equivalent copies to measure
   reproducibility. Do not spend another trial on Vulkan unless evidence warrants
   it. Record every attempt, including failures; no retry-until-green acceptance.
4. During startup, collect a bounded guest scheduler trace and timestamped CPU,
   memory, and I/O pressure. Capture early enough to include System UI creation.
   Compute scheduler counter deltas only for the same process/thread lifetime.
5. Correlate with host per-core utilization and emulator-process CPU samples.
   If guest evidence cannot distinguish runnable host threads from expensive
   guest work, propose a short Windows scheduling trace as a separate step.
   Do not silently enable system-wide tracing: it can capture unrelated process
   names, paths, and activity. Obtain agreement on scope and local retention first.
6. Change only the factor supported by that evidence, then repeat the baseline
   and candidate from equivalent copies. Do not infer CPU affinity from logical
   processor numbering or change power plans, priority, drivers, antivirus, or
   hypervisor configuration speculatively.
7. Restore and verify the user's normal emulator, then immediately release the
   pause window. Once startup is reproducibly healthy, rebuild and run the held
   authenticated Capacitor and Expo acceptance checks.

Raw traces are local diagnostic artifacts, not telemetry or public attachments.
Collect guest startup traces only on the never-authenticated synthetic readiness
device; do not extend raw capture into OAuth or authenticated app testing.

## Source interpretation

- [Linux scheduler statistics](https://kernel.org/doc/html/latest/scheduler/sched-stats.html)
  defines runtime, runqueue wait, and timeslice counters; interval analysis needs
  differences between observations.
- [Android ANR diagnosis](https://developer.android.com/topic/performance/anrs/diagnose-and-fix-anrs)
  distinguishes system load from app problems and recommends scheduler/thread
  state analysis with Perfetto.
- [Windows CPU analysis](https://learn.microsoft.com/en-us/windows-hardware/test/wpt/cpu-analysis)
  describes precise context-switch analysis for ready versus running threads.
- [Android hardware acceleration](https://developer.android.com/studio/run/emulator-acceleration)
  recommends WHPX on Windows. Our saved logs confirm WHPX was operational;
  switching hypervisors is not justified by the current evidence.

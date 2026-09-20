# Android startup investigation — 2026-09-19

## Current conclusion

The disposable API 36 emulator can fail before AbsoluteJS applications are
installed. Captured evidence supports CPU scheduling pressure during System UI
initialization, but does **not** establish the host-side cause or a reliable fix.
Keep emulator defaults, ANR rejection, CPU-settling checks, and the framework
publication hold unchanged. A readiness pass is not authenticated native acceptance.

This investigation used saved evidence only; it did not restart an emulator,
change host settings, or require other work to pause.

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

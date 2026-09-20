# Installed Android server-data and offline Sync acceptance

Run from the **AbsoluteJS framework repository root**, not an application or
generated native directory:

```sh
bun run test:native:android:data
```

To diagnose emulator startup **without compiling or installing any app**, run
this first from the same repository root:

```sh
bun run test:native:android:readiness
```

It uses the same disposable device and prerequisites, then checks three initial
launcher snapshots plus nine more across three settling rounds. It prints a
separate evidence directory containing `readiness-report.json` only on success,
snapshot acquisition logs, XML, and final screenshot/logcat when available.
This is an emulator readiness result, **not** app, HTTPS, or Sync acceptance.
It will not dismiss crash dialogs. Capture failures cannot prevent cleanup.
The guarded `ABSOLUTE_TEST_RELEASE_REUSE_RUN` option below also applies to this
command for a cold-boot comparison against an initialized disposable device.
Its report distinguishes fresh from reused test userdata; neither mode modifies
your normal AVD. No report is written if initial readiness fails.

This opt-in maintainer gate builds the existing Capacitor and Expo release
fixtures, installs their AAB-derived APKs, and drives their visible UI with
Android UI Automator. It is separate from `mobile test android --release`,
which proves embedded shell startup/relaunch, and does not extend release
certification policy automatically.

Both signed builds finish **before** the disposable emulator starts. The harness
records `builds-completed.json`, then boots the emulator, checks launcher
readiness, and installs/tests those exact artifacts without compiling again.
This separates build CPU pressure from emulator startup and UI acceptance.
The HTTPS backend imports the corresponding **built** `server.js`, not raw
`server.ts`: the server build injects the page identities and contracts matched
by the embedded client. Each passing engine report includes the server bundle's
SHA-256. The challenge is still supplied at startup after the builds finish.
After the offline-shell check, the harness enables the disposable device's
radios and waits for Android to report a currently connected default network
before launching the HTTPS check. Radio-enable command completion alone is not
network readiness. `network-before-https.txt` records this precondition; it is
not proof of backend reachability or successful TLS validation.
An occupied test serial is still refused; the harness does not stop unrelated
emulators or other development workloads automatically.

## Prerequisites and local HTTPS

- Install the managed Android SDK, API 36 Google APIs x86_64 image, JDK, and
  Bundletool used by the existing Android release tests.
- Install `mkcert` and `openssl`. The harness generates a new isolated CA with
  AbsoluteJS's existing HTTPS certificate helper. It does **not** run
  `mkcert -install` or modify the host's trust store.
- Keep emulator port 5580 and local TCP port 48443 free. The harness refuses an
  occupied emulator serial. Your normal emulator may stay running.
- The default AVD template is `~/.android/avd/AbsoluteJS_API_36.avd/config.ini`
  (the Windows user profile under WSL). For another location, set
  `ABSOLUTE_TEST_RELEASE_AVD_CONFIG` to that API 36 template's config file.
- Allow time and disk space for a **fresh** virtual device and both native
  builds. The test has a 90-minute limit; first boot may take several minutes.

The helper copies only the template configuration into a unique temporary AVD,
not the existing emulator's userdata. Only that new emulator receives the public
test CA through an ephemeral system-trust mount. Neither app receives debug
trust exceptions, custom trust managers, or disabled hostname validation.
The local backend listens on loopback with HTTPS; ADB reverse forwarding carries
the connection. No owned domain, public tunnel, production data, or production
signing credential is needed.

## Evidence checklist

- [ ] Both engines build signed AABs using the generated synthetic test identity.
- [ ] The existing installed/offline shell gate passes for each artifact.
- [ ] Before installing the CA, the first release app shows its load failure
      and does not display the server challenge.
- [ ] After emulator-side trust is installed, both apps visibly render a typed
      server challenge created **after** their build and connect to real Sync.
- [ ] With radio transports disabled, ADB reverse removed, **and the selected
      device's ADB transport reconnected to close existing TCP streams**, the visible
      UI retains one pending mutation while the server has zero writes.
- [ ] After reconnect, the pending count becomes zero, the server reports one
      write, and its receipt appears in the UI.
- [ ] The emulator and synthetic backend stop when the test finishes or fails.

The command prints its unique `.absolutejs/release-data-conformance/<run>/`
directory. Each engine has `report.json`, UI XML, screenshots, build/server logs,
and separate shell evidence. A report is written as `pass` only after that
engine completes all checks. Missing reports or a nonzero test exit are not a
pass. Share the **per-engine evidence directories**, not the entire run root:
the latter also contains the private test CA and throwaway signing keystore.
`temporary-avd-path.txt` identifies the retained temporary AVD for inspection
and later cleanup after confirming no process is using it.

For a retry after expensive first-boot initialization, you can reuse **only a
previous disposable test AVD**, still shut down between runs:

```sh
ABSOLUTE_TEST_RELEASE_REUSE_RUN=.absolutejs/release-data-conformance/<run-id> \
  bun run test:native:android:data
```

The helper verifies that the run lives under this repository's evidence root
and points to its named temporary test AVD. It refuses normal AVD directories.
Each retry still gets a new CA and test signing identity; system-trust mounts
do not survive emulator shutdown. Reuse retains synthetic test userdata, so it
is not evidence of a pristine first-ever app installation.

## What this does not prove

Keep the computer awake throughout the gate. A host sleep or Android System UI
ANR can invalidate UI automation; it must not be reported as passing app evidence.
The harness does not stop unrelated emulators for you.
After building and before installation, it requires three responsive launcher snapshots separated by
10-second settling intervals. A startup ANR or obscured launcher fails this
preflight; snapshots and a failure log are retained in the run root. It does
not automatically dismiss Android crash dialogs or increase ANR timeouts.
Before UI acquisition, a test-only load guard samples `/proc/pressure/cpu`:
three consecutive `some avg10` readings at or below 20%, five seconds apart,
within 36 samples. Raw readings are saved as `boot-cpu-*.txt`; missing or invalid
readings fail closed. This is a startup-load heuristic, **not** a UI-health
assertion: all launcher and ANR checks still run afterward. Android's
[UiAutomation connection has its own short timeout](https://android.googlesource.com/platform/frameworks/base/+/master/core/java/android/app/UiAutomation.java),
so issuing it immediately after boot completion can race ongoing system work.
Every UI acquisition uses a new UUID-named file and requires UI Automator's
acknowledgement before reading it. UI Automator can exit zero without writing
XML, so an exit code alone is insufficient. Acquisition retries are bounded;
the harness saves command diagnostics and screenshots even when XML is missing.
Snapshots from runs before this fresh-file check are not reliable evidence of
the current UI state and must be revalidated.
For renderer diagnostics, `ABSOLUTE_TEST_RELEASE_GPU=host` passes `-gpu host`
to the disposable emulator without editing your normal AVD. Other supported
values are `auto`, `software`, `lavapipe`, `swiftshader`, and `swangle` (check
your installed emulator's `-help-gpu`). Omit it to preserve the AVD default.
This is a diagnostic override, not a universal recommendation or an acceptance
result: hardware drivers can have their own compatibility problems.
To isolate Vulkan while retaining the selected GLES renderer, set
`ABSOLUTE_TEST_RELEASE_DISABLE_VULKAN=1`. This adds Android's documented
`-feature -Vulkan` argument only to the disposable emulator; `0` or omission
preserves the default. The choice is recorded in `emulator-options.json`.
For example, from the framework repository root:

```sh
ABSOLUTE_TEST_RELEASE_GPU=host ABSOLUTE_TEST_RELEASE_DISABLE_VULKAN=1 \
  bun run test:native:android:readiness
```

Compare one setting at a time with the same owned AVD and resource preconditions.
Passing without Vulkan is not evidence for Vulkan-dependent applications, and
this diagnostic does not change normal AVD defaults or weaken readiness checks.
See [Android's documented Vulkan troubleshooting flag](https://developer.android.com/studio/run/emulator-troubleshooting#cannot-open-webpage-correctly).

Local diagnostic result (2026-09-19, Windows/WHPX, Android emulator 37.1.11,
API 36 Google APIs, host GPU, 4 cores / 3072 MB): the default-Vulkan run
passed all 12 readiness snapshots; the subsequent Vulkan-disabled run on the
same initialized disposable AVD produced a System UI startup ANR before any
application was installed and failed the CPU-settling gate. Boot times were approximately 43 and 79 seconds,
respectively. The captured ANR reports a 20-second KeyguardService timeout;
System UI's main thread was runnable, with about 3.95 seconds of accumulated
CPU time and 20.04 seconds of accumulated scheduler wait. Those counters are
cumulative, not a measurement of the timeout interval alone. This supports
investigating guest CPU scheduling pressure, but does not establish its host-side
cause. Sequential boots also change guest state, so this is not a controlled
benchmark. Disabling Vulkan is **not** a demonstrated fix; keep defaults and
readiness gates unchanged. Readiness alone does not satisfy authenticated
installed-app acceptance or authorize framework publication.

See the [startup investigation](MOBILE_ANDROID_STARTUP_INVESTIGATION.md) for
the saved-trace analysis, persisted-state confound, and next controlled experiment.

When the failure snapshot contains Android ANR controls, `failure.json` records
`reason: "android-anr-dialog"`. The test still fails; it does not dismiss the
dialog or infer that the application passed its TLS check.

This uses React route fixtures on both engines. It is not all-framework data
coverage, iOS evidence, public DNS/CA validation, store delivery, or authenticated
durable Sync. The mutation remains in memory while the app stays alive; no
process-death, account isolation, or durable exactly-once guarantee is asserted.
Bundletool signs generated APKs with its test key independently of the synthetic
AAB signature. Neither identity is a publishing credential.

The iOS partner checklist remains in [IOS_MACOS_TESTING.md](IOS_MACOS_TESTING.md).
Do not ask a partner to run this Android-only gate as an iOS acceptance test.

## Current local checkpoint

Run `39944aed-4d64-4171-9ee8-48ff4ed35179` produced a passing Capacitor report
covering live props and offline Sync recovery. Expo passed its offline-shell
marker but showed a blank screen during live-content loading; the combined test
failed and no passing Expo data report was written. This is a partial result,
not certification of both engines. Startup readiness separately passed all 12
fresh snapshots with the settling guard. Final unit verification: 1,367 tests,
18,547 assertions, zero failures; TypeScript and focused lint also pass.

### Expo loading investigation (2026-09-17)

Source inspection found a concrete incompatibility before server-data loading:
`expoProject.ts` opens the materialized `index.html` with a `file://` URI,
while `shellBootstrap.ts` reads `./absolute-mobile-manifest.json` with browser
`fetch()`. Chromium documents that WebView's file-access settings do not enable
Fetch API access to file URLs. Its recommended local-resource approach is a
virtual HTTP(S) origin using `WebViewAssetLoader`:
[Chromium WebView CORS documentation](https://chromium.googlesource.com/chromium/src/+/HEAD/android_webview/docs/cors-and-webview-api.md).

A desktop Chromium comparison of the existing Expo bundle reproduced a rejected
file-URL manifest fetch and blocked file-URL module script. Serving the same
files over loopback HTTP returned HTTP 200 for the manifest and executed the
bootstrap until the expected missing native-bridge error. This is supporting
origin-isolation evidence, **not** an Android reproduction or proof that this is
the sole cause of the installed app's entirely blank screen.

The offline-shell marker is also insufficient: the generated bridge emits
`ready` from `injectedJavaScriptBeforeContentLoaded`, before page activation.
The release React Native WebView implementation suppresses console messages, so
absence of JavaScript errors in filtered logcat is not evidence of successful
bootstrap execution.

The on-device file/module probe in run
`bbbd0681-02d3-4867-80c4-8f566e9caad6` never reached app launch or cache edits:
host CPU reached 100%, and WSL-to-Windows ADB failed with
`UtilAcceptVsock ... accept4 failed 110` during startup CPU settling. The owned
test emulator was stopped; normal emulator 5554 was restored and its boot
completion verified. No production runtime fix has been applied.

Next implementation proposal: provide a narrowly scoped embedded asset origin
for Android (evaluate `WebViewAssetLoader` integration), separately verify the
iOS loading design, report bootstrap/load failures visibly, and gate readiness
on actual page activation. Preserve strict TLS, origin boundaries, and asset
path validation. Then rerun the installed Expo live-props/offline-Sync gate;
do not treat the desktop comparison or the early bridge marker as acceptance.

### Asset-host implementation and installed acceptance

For a targeted rerun, `ABSOLUTE_TEST_RELEASE_ENGINE=expo bun run
test:native:android:data` builds and tests only Expo (`capacitor` is also
supported). Omit the variable for both engines. A selected-engine run does not
certify the other engine; retain its separate report or rerun the combined gate.

The Android Expo generator now creates an AbsoluteJS-owned extension of the
upstream React Native WebView manager and client. It uses AndroidX
`WebViewAssetLoader` for a virtual `https://appassets.androidplatform.net`
origin, with no listening server, CA exception, or dependency-source patches.
Only explicitly registered embedded files under the application's
`files/absolutejs-web/amexpo_<hash>` directory may be served. Unknown asset-host
requests fail locally rather than reaching DNS. Root-relative subresources are
scoped to the bundle in the requesting WebView.

The native bridge uses origin-scoped document-start injection to avoid racing
the bootstrap module. Startup errors/timeouts produce a retry screen. The
embedded-ready marker follows shell rendering (including a rendered connection
fallback), not bridge installation; page-activation failures cannot satisfy it.
The live-data gate still independently requires its post-build challenge and
Sync receipt. Expo's runtime fingerprint includes an embedded-assets ABI, so
older installed native binaries are not eligible for these OTA bundles.

The signed Expo Android build and installed live-data/offline-Sync gate passed
in run `419252c1-6ba1-4605-9e1d-3aba59192bce` on September 18, 2026 UTC.
Its report records offline launch/relaunch, a fresh rendered server challenge,
one offline pending mutation and zero writes, then zero pending mutations and
exactly one server write after reconnect. Capacitor's separate passing report
is in run `aabf6b8e-8254-4260-bb00-f4f4c2fc593a`. Both used a reused, identity-checked
disposable API 36 AVD and an isolated emulator system CA. These are not fresh-AVD,
public-CA, authenticated durability, process-death, or store-certification proofs.
iOS retains its existing WKWebView loading mechanism and requires the
new `EXPO-IOS-EMBEDDED-*` partner checks; Android's asset loader is not an iOS fix.

Further isolation found an independent asset-materialization defect: the installed
HTML was zero bytes, and the bootstrap contained a 653-byte PNG rather than the
expected JavaScript. The release source map contained both Expo's virtual asset
registry and the physical React Native registry. Numeric asset IDs are local to
each registry and must not cross between them. The generated TypeScript wildcard
paths bypassed Expo's virtual registry for application assets. The generated app
now uses Expo's supported `experiments.tsconfigPaths: false`: its TypeScript paths
are for declaration lookup only, while Metro/Expo retain runtime resolution.
No custom registry resolver or dependency patch is installed. See
[Expo's TypeScript path-alias controls](https://docs.expo.dev/guides/typescript/#disable-path-aliases).

The archive loader also verifies asset type/hash, archive length/checksum, and
each extracted file's length/checksum, including cached files. These MD5 checks
detect accidental corruption and identity mismatches; they are not signatures
or a replacement for the signed app/update and SHA-256 mobile manifest. Regression
tests cover wrong-resource identity, truncated/corrupt archives, short writes,
and repair of same-length corrupt cached files. The passing release source map
contains only Expo's single virtual asset registry. The normal emulator was
restored and its boot completion verified; no other Codex sessions were stopped.

Release verification for `0.20.0-beta.116`: 1,373 unit tests / 18,607 assertions,
143 passing non-HMR integration tests / 891 assertions across 31 files, package
build, format, lint (warnings only), TypeScript, client-bundle isolation,
changelog/API verification, and a fresh packed-package compile check passed.
The integration inventory skipped its two opt-in rows: published-package compile
was subsequently covered by the fresh local tarball check; durable S3 storage
was not enabled. The long HMR inventory and iOS acceptance were not rerun.

## Next acceptance: authenticated, persistent outboxes

The `.116` registry artifact has been downloaded and its SHA-1 verified against
the publish result (`cd161abd66440f542edaf42acff99587b32b7c96`). Registry metadata
and tarball availability propagated separately; no second publish was needed.

The next installed-release gate must run independently for Capacitor and Expo:

The opt-in harness is now `tests/native/android-authenticated-release-conformance.test.ts`.
Run it from the **AbsoluteJS repository root** (the directory containing this
document's `docs/` folder and the framework's `package.json`), not from a generated
Android directory or your application:

```bash
bun install
bun run test:native:android:auth-sync
```

For a single-engine diagnostic run:

```bash
ABSOLUTE_TEST_RELEASE_ENGINE=expo bun run test:native:android:auth-sync
ABSOLUTE_TEST_RELEASE_ENGINE=capacitor bun run test:native:android:auth-sync
```

These are long, resource-heavy tests requiring the Android toolchain and the
existing disposable-emulator/local-CA prerequisites described above. They build
the separate private `tests/fixtures/*-android-authenticated-release` projects;
the anonymous release fixtures are unchanged. The harness provisions dependencies
with `absolute mobile init --yes` before building, creates the Capacitor Android
project on its first run, and reuses that generated project on retries. This can
update the fixture's package manifest and the repository lockfile. Android
association fingerprints are derived from the run's disposable signing certificate,
not a production credential or placeholder. An occupied test emulator on port 5580 is an
error, not permission to stop another device. Pause other heavy work first.

The backend uses real AbsoluteJS Auth browser login, PKCE, resource-scoped tokens,
socket tickets and Sync. Its login form explicitly selects one of two synthetic
users; it is **test code, not a production login implementation**. Native app code
uses portable Auth/Sync APIs. Server writes and deduplication receipts share a
SQLite transaction. A test-only Sync partition leaves Auth reachable during
account switching, so reconnecting for login cannot conceal an outbox leak.

Each run prints its evidence directory under `.absolutejs/release-data-conformance/`.
Send only `<run>/<engine>/authenticated-report.json`, which records completed
phases and the failing phase, if any. A failure before emulator/build setup may
not create a report. Raw OAuth UI, callback URLs and logcat are deliberately not
captured after authentication begins. Do not share the whole directory: it
contains synthetic signing material, an isolated test CA and a server database.
The harness is implemented but **installed execution is not yet verified**.

Local attempt on September 18, 2026: the authenticated Capacitor fixture produced
a signed AAB (`d9e83749f60458a9ddc39a48a1da3b3d514f1a9e948429e9832f479551a1cb04`)
in run `3fbc6a2b-d6f8-4a77-a238-5af0357c09db`. The reused disposable emulator then
failed startup readiness with a System UI ANR, before app installation. A separate
fresh-device run, `2d583649-bbc2-411f-b5d0-9358f108f755`, performed no app build or
installation and failed the CPU-settling guard. These are infrastructure failures,
not passing Auth/Sync evidence and not proof of an app defect. The normal emulator
was restored and its boot completion verified. Expo's authenticated build and both
engines' installed authenticated checks remain pending. No release was published
from these attempts.

Before the next native run, use the corrected dependency provisioning described
in [MOBILE_NATIVE_DEPENDENCIES.md](MOBILE_NATIVE_DEPENDENCIES.md). The audit found
stale CLI pins and incompatible Sync adapter peer declarations, plus fixture-local
copies shadowing the repaired workspace graph. These fixes do not explain or
resolve Android startup failures that occurred before app installation. The
framework release remains on hold until installed native checks pass.

- [ ] Sign in as synthetic account A through the system browser and AbsoluteJS
      Auth's actual authorization-code/PKCE and socket-ticket endpoints.
- [ ] Queue a mutation while disconnected, using the provisioned native SQLite
      store, not an in-memory test transport.
- [ ] Force-stop and reopen the same installation without clearing its data.
      An offline connection-fallback screen is acceptable; it is not proof of
      durable outbox restoration by itself.
- [ ] Reconnect and observe the original mutation's receipt, an empty outbox,
      and exactly one server-side effect. A subsequent reconnect must not add
      another effect.
- [ ] Change to synthetic account B and verify that neither A's cached rows nor
      A's queued operations are exposed or executed as B. Return to A and
      verify its account-scoped data independently.
- [ ] Record only phase results, synthetic identities, counts, and timings.
      Do not include authorization codes, bearer/refresh tokens, socket tickets,
      callback URLs, signing keys, or the entire evidence directory in reports.

Unreleased preparation uncovered a generated Expo bridge lifecycle gap: a bridge created
before login stayed unauthenticated after login. The replacement implementation
binds the first login, closes old account resources on sign-out/account changes,
rejects stale request results and socket tickets, and suppresses old account
events. A revoked bridge stays unusable even if the user switches back; the
existing runtime reload must create a new bridge before another account can use
Sync. This prevents queued messages from an old page acquiring new authority.
Generated-runtime
regression coverage exercises these transitions and rapid account changes.
This is not installed-release or SQLite process-death evidence. The checklist
above remains pending until both engines pass on an installed signed app; the
previous anonymous release-data reports must not be promoted to that claim.

The account-reset path also uses Expo's `reloadAppAsync` to reload the current
runtime, rather than `Updates.reloadAsync`. Account isolation must work with OTA
updates disabled and must not activate a pending update as a side effect of
sign-out. The update-installation path retains its update-specific reload.
See [Expo's distinction between app and update reloads](https://docs.expo.dev/versions/latest/sdk/updates/#updatesreloadasyncoptions).

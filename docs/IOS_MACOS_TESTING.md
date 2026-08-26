# AbsoluteJS iOS and TestFlight macOS test runbook

This runbook validates the iOS release path shipped in
`@absolutejs/absolute@0.20.0-beta.23` and
`@absolutejs/deploy@0.24.0`. It covers a signed local IPA, an internal
TestFlight upload, retry behavior, and installation on an iPhone or iPad.

Use a staging App Store Connect application if possible. Uploading a build
creates durable Apple-side records even when the build is only used by internal
testers.

## 1. What the tester needs

- A Mac with a currently supported Xcode release. Apple currently requires iOS
  apps uploaded to App Store Connect to be built with Xcode 16 or newer.
- An active Apple Developer Program team.
- Access to an App Store Connect app and its matching Apple Developer App ID.
- Permission to sign the app and manage its TestFlight builds. `App Manager` is
  the recommended App Store Connect role for this test.
- A TestFlight internal-testing group with at least one tester.
- Bun and the application's source code.

Apple references:

- [Upload builds](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds)
- [App Store Connect API keys](https://developer.apple.com/help/app-store-connect/get-started/app-store-connect-api/)
- [Certificates overview](https://developer.apple.com/help/account/certificates/certificates-overview/)
- [TestFlight overview](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/)

The signing identity and the App Store Connect API key are separate:

- Xcode uses the Apple Account, team, distribution certificate, and provisioning
  profile to sign the IPA.
- AbsoluteJS uses an App Store Connect team API key to upload the already-signed
  IPA and configure TestFlight.

Never send either credential in a bug report or commit it to Git.

### How to use this runbook

Work from top to bottom and check each box only after observing the stated
result. Use `SKIPPED` only where a step explicitly says it is optional. If a
step fails, keep going only when it is safe to do so and record its test ID,
actual result, sanitized logs, and artifact or screenshot path in section 13.

- [ ] `SETUP-01` Record the Mac, Xcode, Bun, device, and package versions.
- [ ] `SETUP-02` Complete Xcode setup and confirm an iOS runtime is installed.
- [ ] `SETUP-03` Install the exact packages in section 3.
- [ ] `SETUP-04` Configure the staging bundle ID and production server origin.
- [ ] `SETUP-05` Generate or synchronize iOS and resolve Xcode signing warnings.
- [ ] `DEV-01` Complete the cold and warm `bun dev` simulator runs.
- [ ] `DEV-02` Complete route traversal, HMR timing, relaunch, and recovery.
- [ ] `CAP-01` Complete automatic device-capability provisioning.
- [ ] `FILES-01` through `FILES-08` Complete the Documents checklist.
- [ ] `LOC-01` through `LOC-14` Complete the foreground-location checklist.
- [ ] `AUTH-01` Complete system-browser sign-in and callback.
- [ ] `SYNC-01` Complete online, offline, reconnect, isolation, and conflict tests.
- [ ] `BGSYNC-01` Complete physical-device background Sync acceptance.
- [ ] `REMOTE-01` Complete remote-Mac acceptance, or mark it `SKIPPED`.
- [ ] `BUILD-01` Pass release doctor and produce a signed IPA.
- [ ] `SHIP-01` Upload, process, assign, and install the TestFlight build.
- [ ] `UPDATE-01` Prove retry reuse and a subsequent web-only update.
- [ ] `REPORT-01` Fill every report row in section 13 with `PASS`, `FAIL`, or
  `SKIPPED`; attach sanitized evidence for every failure.

## 2. Prepare Xcode

Install Xcode from the Mac App Store, launch it once, sign in to the correct Apple
Account under **Xcode > Settings > Accounts**, and let it install requested
components. Then run:

```sh
sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -license accept
xcodebuild -version
xcrun simctl list runtimes
```

If there is no available iOS runtime, run this from the application directory:

```sh
bunx absolute mobile doctor ios --fix
```

The guided fix downloads an iOS Simulator runtime after Xcode itself is
installed. A simulator is useful for development testing, but App Store signing
still requires the developer team setup described below.

## 3. Install the tested package versions

From the root of the AbsoluteJS application:

```sh
bun add @absolutejs/absolute@0.20.0-beta.23 \
  @absolutejs/auth@0.72.0 \
  @absolutejs/sync@2.29.0 \
  @absolutejs/sync-capacitor@0.9.1 \
  @absolutejs/deploy@0.24.0 \
  @absolutejs/blob@0.5.2 \
  @capacitor/core@8.5.0 \
  @capacitor/app@8.1.1 \
  @capacitor/browser@8.0.4 \
  @capacitor-community/sqlite@8.1.1 \
  @capacitor/network@8.0.1 \
  @capacitor/preferences@8.0.1 \
  @capacitor/cli@8.5.0 \
  @capacitor/ios@8.5.0 \
  @absolutejs/devices@0.4.0 \
  @absolutejs/devices-capacitor@0.5.0
```

`absolute mobile init` now offers to install this tested Capacitor/device
toolchain when it is missing; `mobile init` and `mobile sync` also offer the
SQLite plugin and adapter when the application declares `@absolutejs/sync`.
Pass `--yes` in automation. When the application declares `@absolutejs/auth`,
the same build automatically provisions native OAuth. Auth-enabled apps must
mount the package's OIDC provider, and Sync apps should configure the Auth
socket-ticket store/consumer before exercising authenticated reconnects.

Application pages continue to import the normal `@absolutejs/auth/client` and
`@absolutejs/sync/client` APIs. Do not add Capacitor imports, branch on iOS, or
manually edit `Info.plist` for authentication. AbsoluteJS provisions the public
PKCE client, native browser transport, Keychain storage, callback URL scheme,
authenticated Sync ticket transport, account-isolated SQLite cache/outbox, and
resume/connectivity handling from the existing packages and mobile
configuration.

Optional native plugins are derived from named `@absolutejs/devices` imports.
Do not add them to the initial command: the capability acceptance route below
must prove that `absolute mobile sync ios` detects and offers only the plugins it
needs. The tested mappings in this release are Camera 8.2.3, Clipboard 8.0.1,
File Viewer 2.0.2, Filesystem 8.1.3, Geolocation 8.2.2, Haptics 8.0.2, and Share
8.0.1.

Keep the existing compatible versions if the application deliberately pins
newer versions. Record `bun --version` and `xcodebuild -version` for the test
report.

## 4. Configure the application

Merge an iOS version into the application's existing `mobile` configuration.
The bundle ID must exactly match the App ID and App Store Connect app selected
for the test.

```ts
// absolutejs.config.ts
export default {
	// Existing AbsoluteJS configuration...
	mobile: {
		appId: 'com.example.product.staging',
		appName: 'Product Staging',
		platforms: ['ios'],
		ios: {
			version: '1.0.0'
		},
		server: {
			productionOrigin: 'https://staging-api.example.com'
		}
	}
};
```

`mobile.ios.version` is the user-facing App Store version. It accepts one to
three dot-separated integer components. AbsoluteJS allocates the integer build
number automatically when publishing; do not add a manual build-number script.

If this app has no generated iOS project yet, run:

```sh
bunx absolute mobile init
```

If `mobile/ios` already exists, preserve its native customizations and use:

```sh
bunx absolute mobile sync ios
```

The `mobile/ios` directory is source-owned and should normally remain committed.

## 5. Confirm Xcode signing once

Open the generated workspace, not the `.xcodeproj` file:

```sh
open mobile/ios/App/App.xcworkspace
```

In Xcode:

1. Select the **App** project and **App** target.
2. Open **Signing & Capabilities**.
3. Select the intended developer team.
4. Enable **Automatically manage signing**.
5. Confirm that the bundle identifier exactly matches `mobile.appId`.
6. Add any capabilities the application actually uses, such as Associated
   Domains or Push Notifications.
7. Resolve every signing warning shown by Xcode.
8. Build the `App` scheme once. If the team uses locally managed signing, ensure
   an Apple Distribution certificate and matching App Store Connect provisioning
   profile are installed in the tester's keychain and Xcode.

Also create the app in App Store Connect before uploading. Its bundle ID must be
the same explicit App ID. Create an internal TestFlight group—for example,
`AbsoluteJS Internal`—and add the tester to it.

## 6. Run the preflight and signed-IPA test

### First-class simulator and HMR acceptance

Before building the signed IPA, verify the normal development loop. Start the
application in an interactive terminal:

```sh
bun dev
```

When iOS is configured and Xcode is available, AbsoluteJS should:

1. Reuse or create the managed `AbsoluteJS iPhone` simulator on the newest
   installed iOS runtime.
2. Synchronize Capacitor and apply a temporary localhost development URL.
3. Boot the exact simulator by UDID.
4. Build into an isolated, persistent DerivedData directory.
5. Install and launch the app.
6. Stream redacted `[ios]` native logs into the AbsoluteJS terminal.
7. Print the total startup time and the Capacitor, simulator, Xcode, install,
   launch, and logging phase timings.

The first run may download a runtime or perform a full Xcode build. Stop and
restart `bun dev` without changing native inputs. The warm run should say
`native cache hit` and skip both Xcode and installation.

At the AbsoluteJS interactive prompt:

- Enter `d` or `device` to print the simulator UDID, lifecycle state, and HMR
  port.
- Enter `relaunch` to terminate and relaunch the installed application without
  rebuilding it.

In a second terminal, run:

```sh
bunx absolute mobile test ios --report
```

This verifies that the app is installed and launchable, confirms the native iOS
HMR client is connected through `/hmr-status`, and saves a simulator screenshot
with `report.md` and `report.json` in a timestamped directory under
`.absolutejs/mobile/test-reports`. The terminal prints the exact directory to
return. Automated rows are filled from observed results and timings; every
interaction, physical-device, signing, Auth, Sync, and TestFlight row remains
`NOT_RUN` until the tester completes it. To choose a repository-local output
directory, pass `--report .absolutejs/mobile/my-ios-report`.

The command never uploads the report. It redacts recognized credentials, URL
query values, and exact coordinates from captured text. Before returning the
directory, visually inspect its screenshots because an application can render
private information that a text redactor cannot see. Do not add credentials,
signing material, private Sync data, or exact coordinates while completing the
Markdown checklist.

Native development also shows an AbsoluteJS `Sync` button in the lower-right
safe area. It is injected by the native HMR client only; it is not included in
release assets. Open it to inspect redacted pending/conflict counts and retained
dead letters. `Retry unchanged` preserves the original operation ID, `Discard`
requires confirmation, and `Rebase with new args` requires valid JSON plus a
second confirmation because it creates a new operation intent. The panel must
never display cached rows, mutation arguments, credentials, or namespaces.

Before moving on, traverse the example application's ordinary links in this
order: React → Angular → Vue → Svelte → HTML → HTMX → React. Confirm that each
page renders without opening Safari or restarting the native app. Visit HTML a
second time and click its counter to confirm the embedded page module executes
again. On HTMX, click the counter and confirm its request reaches the AbsoluteJS
backend. Repeat the traversal after `relaunch`; the app must start from its entry
route rather than restoring a stale intermediate WebView document. Include any
failed page, screenshot, and Xcode/WebView console output in the report template
at the end of this file.

### Automatic device-capability provisioning acceptance

Add an application page using the provider-neutral surface only:

```ts
import {
	camera,
	clipboard,
	haptics,
	location,
	photos,
	share
} from '@absolutejs/devices';

await clipboard.writeText('AbsoluteJS native capability test');
await haptics.impact('light');
await share.share({
	text: 'AbsoluteJS native capability test',
	url: 'https://absolutejs.com'
});
const permission = await camera.requestPermission();
if (permission.state === 'granted') {
	const capture = await camera.takePhoto({ direction: 'rear' });
	console.log(capture.webPath);
}
const chosen = await photos.pick({ limit: 1 });
console.log(chosen[0]?.webPath);

const locationPermission = await location.requestPermission({
	precision: 'precise'
});
if (locationPermission.state === 'granted') {
	console.log(await location.current({ timeoutMs: 10_000 }));
}
```

Expose each call behind a separate user-initiated button. Do not import
`@capacitor/*`, import `@absolutejs/devices-capacitor`, edit Swift, or edit the
Xcode project. Run `bunx absolute mobile sync ios` and confirm AbsoluteJS names
`camera`, `clipboard`, `haptics`, `location`, `photos`, and `share`, then offers
to install exactly the tested packages used by those imports. The Documents
checklist below adds its three packages separately.

```text
@capacitor/clipboard@8.0.1
@capacitor/camera@8.2.3
@capacitor/geolocation@8.2.2
@capacitor/haptics@8.0.2
@capacitor/share@8.0.1
```

Run sync again and confirm it does not prompt again. Run
`bunx absolute mobile doctor release`; `mobile.device-capabilities` must pass.
Confirm `Info.plist` contains `NSCameraUsageDescription`,
`NSPhotoLibraryUsageDescription`, and `NSPhotoLibraryAddUsageDescription`, all
inside the AbsoluteJS-owned device-capabilities region. It must also contain
`NSLocationWhenInUseUsageDescription` and
`NSLocationAlwaysAndWhenInUseUsageDescription`, as required by the Capacitor
provider. Do not add any of them by hand. The second location key does not mean
this release supports background tracking; `@absolutejs/devices` location is
foreground-only.
In the web preview, confirm clipboard and sharing use browser behavior when the
browser permits it and that haptics safely degrades when vibration is absent. In
the iOS Simulator, confirm clipboard write and the native share sheet. A
Simulator cannot prove physical vibration, so confirm haptics on the TestFlight
device and record that result separately.

For Camera, confirm `takePhoto()` fails without implicitly opening a permission
prompt, then call `requestPermission()` from its button and take a photo. Test a
denial as well as a grant. The Simulator can exercise the picker but may not
provide a real camera feed, so prove capture on the physical TestFlight device.
Confirm `photos.pick()` opens Apple's scoped picker without first asking for
broad library access, and that neither result exposes EXIF data.

### Provider-neutral Documents acceptance checklist

Use this repository's `/native-documents` route. It imports only `documents`
from `@absolutejs/devices`; do not add `@capacitor/*` imports, a runtime branch,
or a native-project edit. The page has separate Query, Pick, Export, and Open
buttons and displays only filename, MIME type, and byte size—never document
content or a path.

- [ ] `FILES-01` Run `bunx absolute mobile sync ios`. Confirm it discovers
  `documents` and offers exactly `@capacitor/file-viewer@2.0.2`,
  `@capacitor/filesystem@8.1.3`, and `@capacitor/share@8.0.1`. Approve, rerun
  sync, and confirm there is no second prompt.
- [ ] `FILES-02` Confirm `mobile/ios/App/App/PrivacyInfo.xcprivacy` contains
  `NSPrivacyAccessedAPICategoryFileTimestamp` with reason `C617.1`. In Xcode,
  confirm the file appears in the App group and under **Build Phases > Copy
  Bundle Resources**. Do not add or edit it manually.
- [ ] `FILES-03` Open `/native-documents` in the normal web preview. Query must
  report `web`; Pick must use the browser picker; Export must download
  `absolutejs-document-test.txt`; Open must use a browser preview. The same page
  source must be used for iOS.
- [ ] `FILES-04` In the iOS Simulator, tap Pick and cancel. Confirm normalized
  error `cancelled`, no crash, and no permission prompt. Tap Pick again, choose
  one `.txt`, `.csv`, or PDF document, and confirm only safe metadata appears.
- [ ] `FILES-05` Pick two permitted documents in one operation. Confirm no more
  than the requested limit of two is returned and the result exposes Blob
  content for application upload but no `path`, `uri`, security-scoped URL, or
  raw provider object in application-visible metadata.
- [ ] `FILES-06` Tap Export, choose **Save to Files**, save the text fixture,
  open it from Files, and confirm its content. Cancel a second export and confirm
  the app remains responsive with a normalized cancellation/failure result.
- [ ] `FILES-07` Tap Open and confirm the native document viewer displays the
  text fixture and returns to the app. Repeat Export and Open three times, then
  inspect the app container in Xcode. The `absolutejs-documents` cache directory
  must contain no staged fixture after each sheet/viewer closes.
- [ ] `FILES-08` Repeat Pick, Export, and Open on the physical TestFlight device.
  Record the device/iOS version and PASS/FAIL only. Do not attach selected file
  contents, private filenames, or screenshots containing private documents.

The default per-document ceiling is 64 MiB and applications may set a smaller
or larger positive `maximumBytes` explicitly. Filename validation rejects path
separators, control characters, `.` and `..`; unit coverage proves these failure
paths. This acceptance run must use disposable, non-sensitive fixtures.

### Foreground-location acceptance checklist

Use a separate button for permission, current position, start watch, and stop
watch. Display the normalized permission, precision, last position, update
count, last error code, and whether a watch is active on the page so screenshots
contain useful evidence. Never print the raw provider payload. The same page
source must run in the browser and iOS app without a runtime branch.
When testing this repository's example, open `/native-location`; it already
implements those controls entirely through `@absolutejs/devices`.

- [ ] `LOC-01` Before requesting permission, call `location.capability()` and
  `location.permission()`. Confirm neither call opens an iOS prompt and record
  both normalized results.
- [ ] `LOC-02` Tap the current-position button before granting permission.
  Confirm the facade rejects with normalized code `permission-required` and does
  not open a prompt.
- [ ] `LOC-03` Tap the permission button, choose **Allow While Using App**, and
  confirm state `granted`. On a device that exposes the choice, enable Precise
  Location and confirm normalized precision `precise`.
- [ ] `LOC-04` Set Simulator **Features > Location > Apple** (or another fixed
  location), tap current position, and confirm finite latitude/longitude,
  non-negative accuracy, and a timestamp. Record the selected simulation.
- [ ] `LOC-05` Tap start watch, change Simulator **Features > Location** to a
  different preset, and confirm the update count increases and the displayed
  coordinates change.
- [ ] `LOC-06` Tap stop watch, change the simulated location again, wait at least
  the configured watch interval, and confirm the update count does not increase.
  Tap stop a second time and confirm cleanup remains safe.
- [ ] `LOC-07` Start a watch, background the app for 15 seconds, and change the
  simulated location. Confirm the app makes no background-tracking claim. Bring
  it foreground, stop the old watch, start a new one, and confirm updates resume
  without duplicate callbacks.
- [ ] `LOC-08` In iOS Settings, disable Precise Location for the test app, return
  to it, query permission again, and confirm granted/coarse behavior is reported
  without another prompt. Confirm current position still succeeds.
- [ ] `LOC-09` Reset the app's location permission with Simulator **Device >
  Erase All Content and Settings** or reinstall the disposable test app. Request
  permission, choose **Don't Allow**, and confirm `permission-denied` from
  current and watch without an implicit second prompt.
- [ ] `LOC-10` Change the app permission to **While Using the App** in iOS
  Settings, return to the app, and confirm a new permission query observes the
  change and current position recovers without reinstalling.
- [ ] `LOC-11` Temporarily disable Location Services in iOS Settings. Confirm
  current/watch fail with a normalized, non-sensitive device error and the app
  remains responsive. Re-enable services and confirm recovery.
- [ ] `LOC-12` With permission granted, terminate and relaunch the app. Confirm
  no watch is falsely shown as active, permission can be queried, and a newly
  started watch delivers exactly one callback stream.
- [ ] `LOC-13` Run the equivalent page in the normal web preview. Confirm it uses
  the browser permission and Geolocation APIs, preserves the explicit prompt
  boundary, and safely reports unavailable when geolocation is absent.
- [ ] `LOC-14` Repeat `LOC-03` through `LOC-06` on the physical TestFlight device.
  Record iPhone/iPad model, iOS version, precise/coarse result, current-position
  accuracy, and watch/cleanup result. Do not include the tester's exact
  coordinates in the report; use `coordinates sane: yes/no`.

`LOC-07` verifies foreground lifecycle recovery only. Persistent background
location is intentionally out of scope and must not be reported as supported.

Finally remove the `share`, `camera`, `documents`, `location`, and `photos`
imports and their usage; remove `@capacitor/share`, `@capacitor/camera`,
`@capacitor/file-viewer`, `@capacitor/filesystem`, and `@capacitor/geolocation`
from the application
dependencies; run sync; and confirm the release doctor still passes while the
generated mobile manifest lists only `clipboard` and `haptics` and the owned iOS
camera/photo/location usage-description region is removed.
AbsoluteJS does not automatically uninstall a dependency because it may be used
outside discoverable application source; this removal is intentionally explicit.

### Native Auth and authenticated Sync acceptance

This acceptance is required for the handoff. Use an application route that uses
the ordinary, type-safe `createAuthClient()` and `createSyncClient()` APIs. The
route must not import `@capacitor/*`, `@absolutejs/devices-capacitor`, or contain
an iOS-specific branch. Its server must mount the `@absolutejs/auth` OIDC
provider with a socket-ticket store, then mount that Auth application before
`syncSocket({ engine })`. Sync automatically mounts the finite authenticated
background route and consumes Auth's typed bridge; do not add a second HTTP
route or manually pass tokens to Sync.
Use a staging identity; do not send its password in the report.

Run `bunx absolute mobile sync ios` once, then start `bun dev` and perform this
sequence in the managed simulator:

1. Open the Auth/Sync route and start sign-in. Authentication must open the
   system authentication browser, not render a password form inside the app's
   WebView.
2. Complete sign-in. The callback URL must return directly to the same app and
   show the expected user without manual URL copying or native-project edits.
3. Confirm Sync reaches ready state and receives its first authenticated
   snapshot.
4. Force the Sync connection to disconnect, then reconnect it. Confirm it
   reaches ready state again and catches up without another login prompt. The
   server must issue and consume a new single-use socket ticket for the second
   connection.
5. Enter `relaunch` in the `bun dev` terminal. Reopen the route and confirm the
   authenticated user is restored from iOS Keychain without entering
   credentials again. Sync must reconnect with another fresh ticket.
6. Stop and restart the backend while leaving the app installed. Confirm the
   page recovers when the backend returns rather than remaining permanently
   stale. If practical, repeat this on a physical device by disabling and
   restoring Wi-Fi.
7. While signed in and Sync is ready, disable network access. Make a supported
   serializable optimistic mutation, quit the app, and relaunch while still
   offline. Confirm the last confirmed rows and pending optimistic change are
   visible from SQLite without a server connection.
8. Restore the network. Sync must reconnect immediately with a fresh ticket,
   deliver the same stable operation ID, converge on the server result, and
   remove the outbox record. Verify in server/database logs that the business
   effect executed exactly once even if the acknowledgment was interrupted.
9. Sign out and relaunch. The previous account must not return, proving that
   native credentials were removed and its offline partition is locked. Sign in
   as a different staging account and confirm none of the previous account's
   cached rows or pending mutations are visible or replayed.
10. Sign back in as the original verified account. Its retained partition may
    become available again; it must be the same converged data, not an exposed
    raw subject identifier or a newly mixed account partition.
11. If the staging app exposes a conflict fixture, make an offline edit and
    advance the same server row from another client before reconnecting. Confirm
    the optimistic overlay rolls back, the operation appears as one typed
    `conflict` dead letter, and it does not retry forever. Open the development
    `Sync` panel and retry it unchanged; confirm the original operation ID is
    preserved. Repeat the fixture, choose `Rebase with new args`, and confirm a
    new operation ID supersedes the old one. Finally repeat and discard it;
    confirm SQLite follows each explicit choice.
12. Use a fixture whose generated `localData` marks one collection and mutation
    `sensitivity: "private"` with `protection: "required"`. After foreground
    Sync writes them, inspect the app's SQLite `record_json` values from Xcode or
    a copied container. They must contain `__absoluteSyncProtected` and must not
    contain a distinctive fixture secret, row payload, or mutation argument.
13. Relaunch offline and confirm the protected rows/outbox still hydrate. Run
    the finite background task and confirm its pull/settlement remains readable
    afterward, proving Swift uses the foreground codec and Keychain key.
14. Tamper with one ciphertext byte in a disposable test installation. Reading
    it must fail closed; it must never return partial/plain data or silently
    replace the record. Delete/reinstall the test app after recording the result.
15. Exercise a very small test quota with disposable and critical projections.
    Confirm the complete disposable projection disappears first, the critical
    projection is never partially truncated, and a pending mutation remains.

### Managed iOS background-Sync acceptance

This part requires a physical iPhone or iPad for the authoritative result.
Simulator and `runNow()` checks validate the finite worker, but iOS does not
promise real `BGProcessingTask` scheduling in Simulator. Connect a development
device to Xcode, select it as the App scheme destination, and run the app once.

Before launching, verify the generated project—not application source—contains:

- `BGTaskSchedulerPermittedIdentifiers` with
  `<mobile.appId>.absolutejs.background-sync`.
- `UIBackgroundModes` containing `processing` while preserving any existing
  modes such as `audio`.
- an AppDelegate registration call before application launch completes.

Sign in, open every collection that should be available offline, and create one
serializable optimistic mutation. Let the foreground app reach Sync-ready, then
background it. In Xcode's debug console, simulate the registered processing
task using the bundle-specific identifier shown above:

```text
e -l objc -- (void)[[BGTaskScheduler sharedScheduler] _simulateLaunchForTaskWithIdentifier:@"com.example.product.staging.absolutejs.background-sync"]
```

This selector is an Apple development/debugging aid; never call it from shipped
application code. Confirm the server receives exactly one authenticated
`POST /__absolute/sync/background`, the mutation is acknowledged once, and the
same account's SQLite rows advance. No WebView or page JavaScript should need to
run. Bring the app foreground and confirm the ordinary collection reflects the
background result without duplicate business effects.

Repeat once with the access token expired but the rotating refresh credential
still valid. Foreground Auth and native background work must serialize refresh
rotation: the session remains valid, the refresh-token family is not revoked,
and neither worker overwrites a newer credential. Then sign out while a run is
being induced and verify a late worker cannot recreate the removed credential
or unlock the signed-out partition.

Finally test the network boundary with a disposable staging configuration:

1. A same-origin discovery document and an issuer-advertised HTTPS token
   endpoint may receive the refresh exchange.
2. Only the exact configured AbsoluteJS origin may receive the Bearer token,
   collection parameters, mutation arguments, or returned Sync data.
3. Redirect the Sync endpoint or change its origin. The worker must fail closed
   without following the redirect or sending credentials/payloads onward.
4. Restore the correct endpoint and induce another run; the retained outbox
   must converge normally.

Record the task identifier, device/iOS model, `lastRunAt`, acknowledged/pulled
counts, and sanitized server request metadata. Do not include tokens, mutation
arguments, collection parameters, returned rows, database files, or Keychain
contents in the report.

Inspect the redacted `[ios]`, Auth-provider, and Sync-server logs while running
the sequence. A passing result has all of these properties:

- The callback exactly matches `<mobile appId in lowercase>://auth/callback`,
  unless `mobile.deepLinks.scheme` deliberately overrides the scheme.
- Authorization uses code flow with PKCE and a public native client; no client
  secret is shipped in the application.
- Authorization codes, access/refresh tokens, socket tickets, passwords, and
  cookies do not appear in URLs, screenshots, terminal logs, telemetry, or the
  report.
- Refresh credentials persist in iOS Keychain, not Capacitor Preferences,
  `localStorage`, or ordinary WebView cookies.
- Every Sync connection consumes one short-lived, single-use ticket. Reusing a
  consumed ticket is rejected.
- The same page source still works in a normal browser, where Auth and storage
  use their web implementations.

Record time from tapping sign-in to return, first Sync-ready time, reconnect
time, relaunch-to-restored-user time, and whether the run used the simulator or
a physical device. Attach a sanitized screenshot of the completed state and
the failure state if any step fails.

Then run the correlated HMR timing test:

```sh
bunx absolute mobile test ios --report --wait-for-hmr
```

After it prints that it is waiting, make and save a harmless visible page or CSS
edit. Success prints the end-to-end iOS HMR duration together with server and
client time. The normal `bun dev` terminal should also print a line beginning
with `[hmr:ios]`. Telemetry records only platform/provider, success, cache state,
and timings—not the app ID, route, simulator UDID, source path, or source text.

Next, make a harmless edit to Swift, an entitlement, native resource, Capacitor
plugin/dependency, `package.json`, or the lockfile. AbsoluteJS should keep the Bun
server running while it synchronizes, incrementally rebuilds with Xcode,
reinstalls, and relaunches the app. Revert the edit and confirm the same flow
returns the native project to its original state.

Finally verify lifecycle recovery:

1. Quit the app in the simulator and enter `relaunch` in the dev terminal.
2. Restart the dev server and confirm the app reconnects to HMR.
3. Interrupt `bun dev` with Ctrl-C.
4. Confirm the source-owned `mobile/ios/App/App/capacitor.config.json` and
   `Info.plist` no longer contain the temporary localhost URL or
   `NSAllowsArbitraryLoads` override.
5. Run `bunx absolute mobile doctor release`; it must pass the iOS development
   journal and transport-safety checks.

When testing the AbsoluteJS framework repository itself rather than an
application, the opt-in real simulator gate automates cold/warm startup, HMR,
relaunch, server reconnect, native rebuild, and screenshots:

```sh
bun run test:native:ios
```

This gate intentionally runs only on macOS with Xcode and can take several
minutes on its first build. Preserve `.absolutejs/mobile-native-conformance`
between runs so the warm-cache measurement is meaningful.

### Remote-Mac acceptance from Windows or Linux

This test is optional for the signing/TestFlight report, but required to accept
the bring-your-own-Mac development protocol. On the Mac, enable **Remote Login**
under **System Settings → General → Sharing**, allow public-key SSH and TCP
forwarding, and make sure the tester can run `bun` and `xcodebuild` over a
non-interactive SSH connection.

From a second Windows or Linux computer containing the same application
checkout, first connect manually and verify the Mac's displayed SSH host-key
fingerprint. Then run:

```sh
bunx absolute mobile pair mac test-mac builder@my-mac.local
bunx absolute mobile remotes
bunx absolute mobile doctor ios --remote test-mac
bun dev
```

The application must already contain the committed `mobile/ios` source project.
Expected behavior:

1. Doctor verifies the remote Mac, Bun, and Xcode without storing SSH credentials.
2. `bun dev` selects `test-mac`, uploads or reuses a SHA-256-verified AbsoluteJS
   agent, synchronizes the project, and opens the real Simulator on the Mac.
3. The terminal on Windows/Linux receives iOS lifecycle, timing, and redacted
   native-log output.
4. A page or CSS edit follows normal HMR without synchronizing the native project
   or invoking Xcode.
5. A Swift, entitlement, native resource, Capacitor plugin, package, or lockfile
   edit synchronizes and incrementally rebuilds the native app while the Bun
   server stays running.
6. `d`, `relaunch`, and Ctrl-C have the same lifecycle behavior as local macOS
   development; a subsequent warm start reports a native cache hit.

Direct interaction with the remote Simulator currently uses the Mac screen or a
trusted remote-desktop connection. The protocol itself carries screenshots and
conformance artifacts. Full setup, security boundaries, and troubleshooting are
documented in `docs/REMOTE_IOS_DEVELOPMENT.md`.

```sh
bunx absolute mobile doctor ios
bunx absolute mobile sync ios
bunx absolute mobile doctor release
bunx absolute mobile build ios
```

For a Sync-enabled app, also open
`.absolutejs/mobile/web/absolute-mobile-manifest.json` and confirm
`sync.storageSchema.components` contains `@absolutejs/app` plus every installed
package that declares `absolutejs.sync.localSchema`. No route or page code should
be needed to provision it. The release doctor must print a passing
`sync.storage-schema` check with those component versions.

Do not pass `--unsigned`. A successful command prints output similar to:

```text
Built signed iOS IPA 1.0.0 in 42.3s.
Artifact: .../.absolutejs/mobile/releases/ios/amobile_ios_<sha256>/App.ipa
Metadata: .../.absolutejs/mobile/releases/ios/amobile_ios_<sha256>/release.json
```

Confirm that both files exist. The release doctor must report no development
server URL, HMR assets, or insecure App Transport Security override in the
packaged application.

## 7. Create an App Store Connect team API key

An Account Holder or Admin creates this under **App Store Connect > Users and
Access > Integrations > App Store Connect API > Team Keys**. Use an `App Manager`
key for this test. Download the `.p8` private key immediately; Apple only permits
that download once.

Record these three values securely:

- Issuer ID from the App Store Connect API page.
- Key ID shown beside the generated key.
- Absolute filesystem path to the downloaded `.p8` private key.

The current adapter expects a team key with an Issuer ID. Do not use an
individual API key for this test.

Export only identifiers and the local key path into the terminal session:

```sh
export APP_STORE_CONNECT_ISSUER_ID='00000000-0000-0000-0000-000000000000'
export APP_STORE_CONNECT_KEY_ID='ABCDEFGHIJ'
export APP_STORE_CONNECT_PRIVATE_KEY_PATH="$PWD/private/AuthKey_ABCDEFGHIJ.p8"
```

Put the private-key directory and local release registry in `.gitignore`:

```gitignore
private/
.absolutejs/mobile/test-release-registry/
```

## 8. Add the local test release registry

Create `mobile.release.ts` in the application root. This local filesystem store
is appropriate for a single-Mac smoke test and, importantly, preserves build
allocation and retry receipts between commands.

```ts
import { localBlobStore } from '@absolutejs/blob/local';
import { createAppStoreConnectReleasePublisher } from '@absolutejs/deploy/app-store-connect';
import { createNativeReleaseRegistry } from '@absolutejs/deploy/native-release';

const requireEnv = (name: string) => {
	const value = process.env[name];
	if (!value) throw new Error(`Missing ${name}`);

	return value;
};

const store = localBlobStore({
	root: '.absolutejs/mobile/test-release-registry'
});
const releases = createNativeReleaseRegistry({ store });
const privateKey = await Bun.file(
	requireEnv('APP_STORE_CONNECT_PRIVATE_KEY_PATH')
).text();

export default createAppStoreConnectReleasePublisher({
	auth: {
		issuerId: requireEnv('APP_STORE_CONNECT_ISSUER_ID'),
		keyId: requireEnv('APP_STORE_CONNECT_KEY_ID'),
		privateKey
	},
	receiptStore: store,
	registry: releases
});
```

For team or CI use, replace the local store with the application's S3, R2, or
other durable `@absolutejs/blob` adapter. Do not run concurrent publish jobs for
the same Apple app.

## 9. Upload to an internal TestFlight group

Run the first end-to-end publication with an existing internal group name:

```sh
bunx absolute mobile publish ios \
  --registry mobile.release.ts \
  --channel macos-smoke \
  --testflight-group 'AbsoluteJS Internal' \
  --testflight-notes 'en-US=AbsoluteJS macOS signing, upload, and TestFlight smoke test.'
```

Including a `--testflight-*` option is what requests App Store Connect delivery.
`--channel` alone only promotes the immutable artifact in the AbsoluteJS release
registry.

The command will:

1. Build the production web/mobile bundle and synchronize Capacitor.
2. Run release safety checks.
3. Ask App Store Connect for a stable next build number.
4. Archive and sign the app with Xcode.
5. Export and hash an immutable IPA.
6. Upload it through Apple's Build Upload API.
7. Wait for Apple to process it.
8. Add the processed build to the requested TestFlight group.

Apple processing can take several minutes. The adapter waits for up to 20
minutes. Success ends with output similar to:

```text
Published iOS release amobile_ios_<sha256> on macos-smoke.
Uploaded App Store Connect build 1.0.0 (17); committed.
```

## 10. Verify in App Store Connect and on a device

In App Store Connect:

1. Open the app and select **TestFlight**.
2. Confirm version `1.0.0` appears with the build number printed by AbsoluteJS.
3. Confirm processing completed without an Invalid Binary warning.
4. Confirm the build belongs to `AbsoluteJS Internal`.
5. Resolve any export-compliance prompt Apple shows. If the app qualifies, set
   the appropriate encryption declaration in the native app metadata before the
   next build so this does not remain a manual release step.

On an iPhone or iPad:

1. Install Apple's TestFlight app.
2. Accept the internal invitation using the tester's Apple Account.
3. Install the new build.
4. Launch it from a cold start.
5. Test navigation, server data, authentication, deep links, offline/reconnect
   behavior, and at least one device capability used by the app.
6. Confirm no development URL, HMR overlay, or cleartext-network exception is
   present in the shipped app.

## 11. Test retry and update behavior

First rerun the exact publish command without changing code. It should reuse the
same release/build where possible and must not allocate or upload an unrelated
duplicate. Preserve `.absolutejs/mobile/test-release-registry`; deleting it
removes the local retry and build-allocation history.

Then make a harmless visible web-only change while keeping
`mobile.ios.version: '1.0.0'` and publish again. Expected behavior:

- A new immutable IPA release ID.
- The next integer Apple build number.
- The same user-facing version `1.0.0`.
- The changed UI visible after installing the new TestFlight build.

This proves the normal update loop. Increase `mobile.ios.version` only when the
team wants a new user-facing App Store version.

External TestFlight review is deliberately outside the initial smoke test. If
the internal test succeeds and the app has complete beta metadata, the explicit
form is:

```sh
bunx absolute mobile publish ios \
  --registry mobile.release.ts \
  --testflight-group 'External Beta' \
  --testflight-notes 'en-US=Describe exactly what external testers should test.' \
  --testflight-submit-review
```

Never add `--testflight-submit-review` casually: it creates an external beta
review submission. Merely naming an external group does not submit review.

## 12. Troubleshooting

### Xcode cannot archive or export

- Reopen `mobile/ios/App/App.xcworkspace` and resolve Signing & Capabilities
  warnings.
- Confirm Xcode is signed into the correct team and the bundle ID belongs to it.
- Confirm an Apple Distribution identity is available with
  `security find-identity -v -p codesigning`.
- If the project uses capabilities, confirm its App ID and provisioning profile
  contain the same entitlements.
- Rerun `bunx absolute mobile sync ios`, then `bunx absolute mobile doctor release`.

### `401` or JWT/authentication failure

- Confirm this is an active **team** API key.
- Recheck Issuer ID and Key ID; they are different values.
- Confirm the `.p8` path is readable and still contains the complete private key.
- Confirm the Mac's date and time are correct.

### `403` or authorization failure

Confirm the key is assigned a role that can upload builds and manage TestFlight.
Use `App Manager` for this test rather than broadening it to `Admin` by default.

### App or TestFlight group not found

- App lookup uses the exact `mobile.appId` bundle ID.
- Group lookup accepts the exact group name or its App Store Connect resource ID.
- Ensure the API key's team owns the app.

### Apple processing times out

Check the build under App Store Connect > TestFlight. If Apple is still
processing it, wait and rerun the same command. The persisted receipt allows the
adapter to reconcile the existing upload instead of blindly starting over.

### Missing Compliance or Invalid Binary

Open the build in App Store Connect for Apple's detailed message. Export
compliance, privacy manifests, entitlements, minimum SDK requirements, icons, and
other binary validation remain Apple platform requirements. Save the exact Apple
message in the test report, but never include signing credentials.

### Immutable release mismatch

Do not edit an IPA or `release.json` under `.absolutejs/mobile/releases`. Make a
source change and build a new content-addressed release instead.

## 13. Test report template

```md
# AbsoluteJS iOS smoke-test report

- Result: PASS / FAIL
- Date:
- macOS version:
- Mac architecture:
- Xcode version:
- Bun version:
- AbsoluteJS version: 0.20.0-beta.23
- Auth version: 0.72.0
- Sync version: 2.29.0
- Sync Capacitor version: 0.9.1
- Capacitor SQLite version: 8.1.1
- Devices version: 0.4.0
- Devices Capacitor version: 0.5.0
- File Viewer version: 2.0.2
- Filesystem version: 8.1.3
- Geolocation version: 8.2.2
- Deploy version: 0.24.0
- App bundle ID (non-secret):
- Marketing version:
- Allocated build number:
- Internal TestFlight group:

Use only `PASS`, `FAIL`, or `SKIPPED` in Result. A failure's Evidence cell must
name a sanitized log, screenshot, or artifact path and briefly state actual
versus expected behavior. Do not report exact coordinates.

| Test ID | Result | Observed result / timing | Evidence or failure details |
| --- | --- | --- | --- |
| SETUP-01 |  |  |  |
| SETUP-02 |  |  |  |
| SETUP-03 |  |  |  |
| SETUP-04 |  |  |  |
| SETUP-05 |  |  |  |
| DEV-01 |  | cold: / warm: |  |
| DEV-02 |  | HMR: / relaunch: |  |
| CAP-01 |  | discovered: / installed: |  |
| FILES-01 |  | discovered packages / idempotent sync: |  |
| FILES-02 |  | manifest reason / target membership: |  |
| FILES-03 |  | web pick / download / preview: |  |
| FILES-04 |  | iOS cancel / selected metadata: |  |
| FILES-05 |  | multi-select limit / path-free result: |  |
| FILES-06 |  | Save to Files / cancel recovery: |  |
| FILES-07 |  | native preview / cache cleanup: |  |
| FILES-08 |  | physical device pick / export / open: |  |
| LOC-01 |  | capability: / initial permission: |  |
| LOC-02 |  | error code: |  |
| LOC-03 |  | permission: / precision: |  |
| LOC-04 |  | coordinates sane: / accuracy: |  |
| LOC-05 |  | update count before/after: |  |
| LOC-06 |  | count after stop: / second stop safe: |  |
| LOC-07 |  | foreground recovery / duplicate callbacks: |  |
| LOC-08 |  | approximate permission/current: |  |
| LOC-09 |  | denial error / no second prompt: |  |
| LOC-10 |  | Settings recovery: |  |
| LOC-11 |  | disabled-services error / recovery: |  |
| LOC-12 |  | relaunch state / callback streams: |  |
| LOC-13 |  | browser behavior: |  |
| LOC-14 |  | device model/iOS / coordinates sane / accuracy / cleanup: |  |
| AUTH-01 |  | sign-in return: / relaunch restore: |  |
| SYNC-01 |  | first ready: / reconnect: / offline result: |  |
| BGSYNC-01 |  | acknowledged/pulled counts: |  |
| REMOTE-01 |  | doctor/HMR/rebuild/cache: |  |
| BUILD-01 |  | IPA path / release doctor: |  |
| SHIP-01 |  | build number / processing / install: |  |
| UPDATE-01 |  | retry reuse / next build: |  |

- Signed IPA build: PASS / FAIL
- App Store upload and processing: PASS / FAIL
- TestFlight assignment: PASS / FAIL
- Physical-device install and cold launch: PASS / FAIL
- System-browser PKCE sign-in and callback: PASS / FAIL
- Keychain session restored after relaunch: PASS / FAIL
- Sign-out cleared the native session: PASS / FAIL
- First authenticated Sync snapshot: PASS / FAIL
- Sync disconnect/reconnect with a fresh ticket: PASS / FAIL
- Backend restart/offline recovery: PASS / FAIL
- Offline process-death cache/outbox recovery: PASS / FAIL
- Exactly-once replay after reconnect: PASS / FAIL
- Cross-account local partition isolation: PASS / FAIL
- Conflict dead-letter retention/remediation: PASS / FAIL / NOT RUN
- Native Sync devtools redaction/retry/rebase/discard: PASS / FAIL / NOT RUN
- Device capability auto-discovery/install: PASS / FAIL
- Clipboard web/iOS behavior: PASS / FAIL
- Native share sheet: PASS / FAIL
- Physical-device haptics: PASS / FAIL
- Explicit camera permission denial/grant: PASS / FAIL
- Physical-device camera capture: PASS / FAIL
- Scoped photo picker without broad prompt: PASS / FAIL
- Provider-neutral Documents web/iOS behavior and cache cleanup: PASS / FAIL
- Foreground location provisioning and generated iOS descriptions: PASS / FAIL
- Foreground location permission/current/watch/cleanup: PASS / FAIL
- Foreground location denial/settings/lifecycle recovery: PASS / FAIL
- Browser location behavior: PASS / FAIL
- Physical-device location result (no exact coordinates): PASS / FAIL
- Sign-in return / first Sync / reconnect / relaunch timings:
- Remote Mac doctor from Windows/Linux: PASS / FAIL / NOT RUN
- Remote Mac HMR and native rebuild: PASS / FAIL / NOT RUN
- Remote Mac warm-cache restart: PASS / FAIL / NOT RUN
- Exact retry reused the release/build: PASS / FAIL
- Web-only update allocated the next build and appeared on-device: PASS / FAIL
- Authentication/deep links/offline reconnect result:
- Relevant sanitized terminal output:
- App Store Connect error text, if any:
- Notes:
```

Do not include the `.p8` key, Issuer ID, JWTs, provisioning profiles, signing
certificates, or full environment dumps in the report.

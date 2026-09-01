# AbsoluteJS iOS and TestFlight macOS test runbook

This runbook validates the iOS release path shipped in
`@absolutejs/absolute@0.20.0-beta.48` and
`@absolutejs/deploy@0.24.0`. It covers a signed local IPA, an internal
TestFlight upload, retry behavior, and installation on an iPhone or iPad.

Use a staging App Store Connect application if possible. Uploading a build
creates durable Apple-side records even when the build is only used by internal
testers.

## Partner handoff: start here

There are two different test tracks in this document. Do not mix their working
directories or commands:

1. **AbsoluteJS framework simulator gate:** clone the public AbsoluteJS
   repository and run its self-contained iOS fixture. This is the first test we
   need from the partner and does not require an application repository,
   App Store Connect app, or physical iPhone.
2. **Application, physical-device, signing, and TestFlight acceptance:** run
   from the root of a real mobile-enabled AbsoluteJS staging application. This
   requires that application's source repository, server entry, AbsoluteJS
   config, staging origin, bundle ID, Apple team, and App Store Connect access.
3. **Expo development-client acceptance:** use the same staging application on
   a temporary branch, switch `mobile.engine` to `expo`, and complete the Expo
   checklist below. This track does not replace the Capacitor release gate.

If you were sent only this Markdown file and were not sent a staging
application repository plus its non-secret configuration values, complete Track
A only. Do not invent an application, bundle ID, server origin, or Apple team.

### Track A — run this first from the AbsoluteJS repository

Track A requires Git, Bun, Xcode, and an installed iOS Simulator runtime, but it
does not require a paid Apple developer account. Open Terminal on the Mac and
run these commands exactly. Every command after `cd absolutejs` runs from the
cloned repository root, which contains this repository's `package.json`,
`bun.lock`, `src`, `tests`, and `example` directories.

```sh
git clone https://github.com/absolutejs/absolutejs.git
cd absolutejs
git checkout 54d00755a093806438da92555bc5cc8a0e2c52fb
bun install --frozen-lockfile
xcodebuild -version
xcrun simctl list runtimes
bun run test:native:ios
```

If the repository was already cloned, use this instead:

```sh
cd /absolute/path/to/the/absolutejs-clone
git fetch origin
git checkout 54d00755a093806438da92555bc5cc8a0e2c52fb
bun install --frozen-lockfile
bun run test:native:ios
```

Do not run Track A from the directory containing this downloaded Markdown file,
from `mobile/ios`, from `App.xcworkspace`, or from another application. The
command runs two suites. A normal successful result ends with ten passing tests:
six development-lifecycle checks covering cold/warm native startup, React HMR,
CSS HMR, relaunch, server reconnect, and a native rebuild; then four production
bundle checks covering ordinary-link traversal across React, Angular, Vue,
Svelte, HTML, and HTMX, the hashed local HTML script, termination/relaunch, and
an installed embedded-bundle upgrade that retains application data. The first
run can take several minutes while Xcode builds each app.

Return these Track A results:

- [ ] The complete terminal output from `bun run test:native:ios`.
- [ ] The output of `bun --version` and `xcodebuild -version`.
- [ ] If a test fails, the test name and the files under
  `.absolutejs/mobile-native-conformance/ios-artifacts` or
  `.absolutejs/mobile-native-conformance/ios-embedded-artifacts`. Do not return
  signing credentials, Apple account details, device identifiers, or unrelated
  logs.

After Track A, continue with Track B only if the staging application checkout
and Apple access were supplied.

### Track B — run from the staging application root

For this track, **application root** or **project root** always means the one
directory containing all of the following:

- the staging application's `package.json`;
- its `absolute.config.ts` or other explicitly supplied AbsoluteJS config;
- its server entry, normally `src/backend/server.ts`; and
- its committed or generated `mobile/ios` directory after `mobile init`.

It does not mean the AbsoluteJS framework clone, the `mobile/ios` directory, the
Xcode workspace directory, or your home directory. Open Terminal 1, change to
the supplied application root, and verify it before doing anything else:

```sh
cd /absolute/path/to/the/staging-application
pwd
test -f package.json && echo "application root: OK"
for file in absolute.config.ts absolutejs.config.ts; do
	test -f "$file" && echo "config: $file"
done
```

If `application root: OK` is not printed, stop: this is the wrong directory. If
the config or server-entry path differs from the examples below, substitute the
paths supplied with the staging application. Sections 3–5 install beta.38,
configure mobile, generate `mobile/ios`, and complete Xcode signing.

Before changing anything, capture a read-only, redacted inventory from this
same application root:

```sh
cd /absolute/path/to/the/staging-application
bunx absolute mobile inspect --config absolute.config.ts --json
```

Return this JSON with the Track B report. `bundle.status: "missing"` is expected
if the application has not been prepared yet; rerun the same command after the
production build. The report contains public app/origin/package metadata but no
credentials, environment values, certificate fingerprints, Apple account data,
device identifiers, absolute paths, or detailed release-doctor messages.

For Simulator development, Terminal 1 runs:

```sh
cd /absolute/path/to/the/staging-application
bunx absolute dev src/backend/server.ts --config absolute.config.ts
```

Leave Terminal 1 running. Open Terminal 2 and return to the exact same
application root:

```sh
cd /absolute/path/to/the/staging-application
bunx absolute mobile test ios --report --wait-for-hmr
```

When Terminal 2 asks for an edit, save one harmless visible page-text or CSS
change in the staging application, visually confirm it in the Simulator, and
then revert that edit.

For a physical device, obtain the selector first:

```sh
xcrun devicectl list devices
```

Then use the same quoted selector in both terminals. Terminal 1 runs:

```sh
cd /absolute/path/to/the/staging-application
bunx absolute dev src/backend/server.ts --config absolute.config.ts --ios-device "DEVICE_IDENTIFIER"
```

Leave it running. Terminal 2 runs:

```sh
cd /absolute/path/to/the/staging-application
bunx absolute mobile test ios --device "DEVICE_IDENTIFIER" --report --wait-for-hmr
```

The physical-device command requires `dev.https: true` in the supplied config.
Do not use a device name in one terminal and a UDID in the other; the values must
be character-for-character identical. Complete the certificate-trust steps when
Terminal 1 prints them. At the end, Terminal 2 prints the exact report directory
under `.absolutejs/mobile/test-reports`. Complete the remaining manual rows and
return that entire directory as described below.

## 1. What the tester needs for Track B

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
- [ ] `PREVIEW-01` through `PREVIEW-08` Complete the SDK-free mobile-preview
  checklist.
- [ ] `DEV-01` Complete the cold and warm `bun dev` simulator runs.
- [ ] `DEV-02` Complete route traversal, HMR timing, relaunch, and recovery.
- [ ] `HTTPS-01` Complete trusted local HTTPS and HMR in the iOS Simulator.
- [ ] `EXPO-01` through `EXPO-08` Complete Expo CNG, HTTPS, web HMR, native Fast
  Refresh, patterned native routing, cleanup, and physical-device enrollment
  acceptance.
- [ ] `EXPO-DATA-01` through `EXPO-DATA-08` Complete automatic typed page-props,
  Auth, query/reload, failure recovery, and production-contract acceptance.
- [ ] `EXPO-DEVICES-01` through `EXPO-DEVICES-12` Complete provider-neutral
  capabilities, privacy, bridge, push, and rebuild-boundary acceptance.
- [ ] `EXPO-AUTH-01` through `EXPO-AUTH-08` Complete Expo system-browser Auth,
  secure restore, native/web parity, and credential-boundary acceptance.
- [ ] `EXPO-REMOTE-01` through `EXPO-REMOTE-08` Complete the two-computer Expo
  Remote Mac workflow, or mark all eight `SKIPPED — no second developer host`.
- [ ] `DEVICEDEV-01` through `DEVICEDEV-10` Complete first-class physical-device
  development, HTTPS enrollment, warm-cache, HMR, relaunch, cleanup, and recovery.
- [ ] `CAP-01` Complete automatic device-capability provisioning.
- [ ] `SYSUI-01` through `SYSUI-08` Complete the Keyboard and System Bars
  checklist.
- [ ] `FILES-01` through `FILES-08` Complete the Documents checklist.
- [ ] `NOTIF-01` through `NOTIF-08` Complete the Local Notifications checklist.
- [ ] `PUSH-01` through `PUSH-08` Complete the native Push Notifications
  checklist.
- [ ] `LOC-01` through `LOC-14` Complete the foreground-location checklist.
- [ ] `AUTH-01` Complete system-browser sign-in and callback.
- [ ] `HTTP-01` Confirm universal HTTP uses native Auth only for the trusted
  AbsoluteJS origin.
- [ ] `SYNC-01` Complete online, offline, reconnect, isolation, and conflict tests.
- [ ] `BGSYNC-01` Complete physical-device background Sync acceptance.
- [ ] `MIGRATE-01` Complete the generated v1-to-v2 installed-schema upgrade.
- [ ] `MIGRATE-02` Complete failed-migration rollback and corrected-build recovery.
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
bun add @absolutejs/absolute@0.20.0-beta.48 \
  @absolutejs/auth@0.75.6 \
  @absolutejs/dispatch@0.9.0 \
  @absolutejs/sync@2.31.0 \
  @absolutejs/sync-capacitor@0.9.2 \
  @absolutejs/deploy@0.24.0 \
  @absolutejs/blob@0.5.2 \
  @capacitor/core@8.5.0 \
  @capacitor/app@8.1.1 \
  @capacitor/browser@8.0.4 \
  @capacitor-community/sqlite@8.1.1 \
  @capacitor/network@8.0.1 \
  @capacitor/preferences@8.0.1 \
  @capacitor/keyboard@8.0.5 \
  @capacitor/local-notifications@8.2.1 \
  @capacitor/cli@8.5.0 \
  @capacitor/ios@8.5.0 \
  @absolutejs/devices@0.7.0 \
  @absolutejs/devices-capacitor@0.8.0
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
8.0.1, Local Notifications 8.2.1, and Push Notifications 8.1.2.

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

### Browser mobile-preview acceptance

Start `bun dev`, copy the printed **Mobile** URL ending in
`/__absolute/mobile-preview`, and open it in Safari or Chrome on the Mac. This
preview is the application running against AbsoluteJS's mobile provider
contracts; it is not only a resized web viewport. Complete every step and record
the observed value or failure in section 13:

- [ ] `PREVIEW-01` Open the Mobile URL. Confirm the preview controls and the
  application's configured entry route both render, with no console error.
- [ ] `PREVIEW-02` Switch from iOS to Android and back. Confirm the displayed
  platform and safe-area treatment change without a full `bun dev` restart.
- [ ] `PREVIEW-03` Enter an ordinary application route and open it normally,
  then emit the same route as a deep link. Confirm both reach the same local
  AbsoluteJS route.
- [ ] `PREVIEW-04` Select Wi-Fi, cellular, and offline in turn. Confirm the
  application's `@absolutejs/devices` network state follows each selection and
  an application request fails while offline. Confirm the preview controls and
  HMR remain connected while the simulated app is offline.
- [ ] `PREVIEW-05` Emit active, inactive, background, and active again. Confirm
  the application observes each lifecycle transition once, without duplicate
  listeners after returning active.
- [ ] `PREVIEW-06` Emit hardware Back and keyboard show/hide, then set camera,
  location, and notification permission states. Confirm application code sees
  the provider-neutral values and does not open a real native prompt.
- [ ] `PREVIEW-07` Edit visible page text or CSS. Record the
  `[hmr:mobile-preview]` server/client timing and confirm state is preserved when
  that framework's normal HMR contract permits it.
- [ ] `PREVIEW-08` Introduce a temporary syntax/runtime error, confirm the
  branded overlay appears, fix it, and confirm the overlay clears on the next
  update. Reload the ordinary web URL afterward and confirm preview mocks did
  not leak into the web target.

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

To validate the existing AbsoluteJS HTTPS configuration, set `dev.https: true`
in `absolute.config.ts` and start `bun dev` again. Accept the one-time mkcert
setup prompt if this Mac has not configured it yet. AbsoluteJS must reuse that
same certificate system, add the required development identity when necessary,
and print that it installed the development CA into the managed Simulator trust
store. The app must load without an SSL error, and a page/CSS edit must still
produce an `[hmr:capacitor-ios]` timing without rebuilding the native app.

- [ ] `HTTPS-01` Record whether mkcert setup was needed, whether Simulator CA
  trust succeeded, whether the initial HTTPS page loaded, and the first HTTPS
  HMR timing. After stopping `bun dev`, confirm
  `bunx absolute mobile doctor release` does not report a leaked development
  URL or trust override.

At the AbsoluteJS interactive prompt:

- Enter `d` or `device` to print the simulator UDID, lifecycle state, and HMR
  port.
- Enter `relaunch` to terminate and relaunch the installed application without
  rebuilding it.

### First-class physical-device development acceptance

Keep the Mac and device on the same local network. In Xcode Device Hub, pair the
unlocked iPhone or iPad, tap **Trust** when prompted, and enable Developer Mode.
In the generated `mobile/ios/App/App.xcworkspace`, enable automatic signing and
select the test Development Team once. Then list the device selectors Xcode
accepts:

```sh
xcrun devicectl list devices
```

- [ ] `DEVICEDEV-01` With `dev.https: true`, run
  `bunx absolute dev --ios-device DEVICE_IDENTIFIER`. Confirm AbsoluteJS selects
  the physical target without creating, booting, or requiring an iOS Simulator.
- [ ] `DEVICEDEV-02` On a first or stale-native run, confirm Xcode produces a
  signed `Debug-iphoneos` app, `devicectl` installs it, and the app launches. If
  Xcode requests account, team, device-registration, or provisioning action,
  complete it in Xcode and rerun the same command; do not copy signing material
  into AbsoluteJS configuration.
- [ ] `DEVICEDEV-03` Open the session-only CA URL printed by AbsoluteJS in Safari
  on the device. Install the downloaded AbsoluteJS development CA profile, then
  enable full trust under **Settings > General > About > Certificate Trust
  Settings**. Confirm the URL contains no app ID, route, device identifier, or
  credential and becomes unavailable after `bun dev` stops.
- [ ] `DEVICEDEV-04` Return to the app and confirm the configured route loads over
  HTTPS without an SSL/ATS error. Save one visible page or CSS edit and record the
  `[hmr:capacitor-ios]` timing. Confirm the app updates without Xcode rebuilding.
- [ ] `DEVICEDEV-05` Confirm `[ios]` console entries appear in the same terminal,
  recognized secrets are redacted, and `d` reports a physical `device` target and
  ready state. Do not paste raw device logs into the report.
- [ ] `DEVICEDEV-06` Enter `relaunch`. Confirm the physical app terminates,
  launches again through `devicectl --console`, reconnects to HMR, and preserves
  the expected Auth/Sync state.
- [ ] `DEVICEDEV-07` Stop `bun dev` and start the identical command again without
  native changes. Confirm `native cache hit` appears and both Xcode build and app
  installation are skipped. Make one harmless Swift/native-resource edit and
  confirm exactly one native synchronization, rebuild, install, and relaunch.
- [ ] `DEVICEDEV-08` Disable Wi-Fi briefly, make a web edit, restore Wi-Fi, and
  confirm HMR reconnects and applies the latest valid state. Repeat with one
  temporary source error and confirm the branded overlay clears after correction.
- [ ] `DEVICEDEV-09` Terminate with Ctrl-C during a native rebuild, start the same
  command again, and confirm crash recovery restores the prior production-safe
  Capacitor config and Info.plist before projecting a fresh development URL. Stop
  normally and confirm `bunx absolute mobile doctor release` reports no leaked
  development URL or trust override.
- [ ] `DEVICEDEV-10` If Remote Mac testing is available, run the same command from
  the paired Windows/Linux developer host. Confirm the CA URL uses the Remote
  Mac's LAN address, the device reaches HMR through the LAN-to-SSH relay, and Ctrl-C
  closes both relay and SSH tunnel. Otherwise record `SKIPPED — no Remote Mac
  physical-device setup`. Capture any device screenshot manually in Xcode Device
  Hub; AbsoluteJS intentionally does not capture physical screens automatically.

The installed development CA remains under the tester's control because iOS
requires explicit profile and full-trust approval. Keep it only on a dedicated
development device while repeated testing continues. At the end of the entire
test cycle, disable full trust and remove the AbsoluteJS development CA profile.

### Expo development-client acceptance

Run this only from the staging application root described in Track B, on a
temporary branch where changing the mobile engine is safe. In
`absolute.config.ts`, retain the existing app ID, routes, production origin,
platforms, and `dev.https: true`, but set:

```ts
mobile: {
	// Keep the application's other existing mobile fields here.
	engine: 'expo'
}
```

Do not create or edit `.absolutejs/mobile/expo/android` or `ios` yourself.
AbsoluteJS owns those disposable CNG directories. In Terminal 1, from the
application root, run:

```sh
cd /absolute/path/to/the/staging-application
bunx absolute dev src/backend/server.ts --config absolute.config.ts
```

Accept the pinned Expo dependency installation if prompted. The first run must
say that it is preparing native code, start Metro, build the iOS development
client, install the AbsoluteJS CA into the booted Simulator, relaunch the app,
and finally report that Expo iOS is connected. Keep Terminal 1 running while
performing these checks:

- [ ] `EXPO-01` Confirm `.absolutejs/mobile/expo/app.config.js` and
  `plugins/withAbsoluteDevelopmentCa.js` were generated, and the generated
  `ios` directory was recreated by `expo prebuild --clean`. Do not edit them.
- [ ] `EXPO-02` Confirm an ordinary AbsoluteJS route loads over local HTTPS in
  the Expo WebView with no certificate or ATS error. Record the CA-install log
  and initial native-build time.
- [ ] `EXPO-03` Save one visible edit to an ordinary AbsoluteJS page. Confirm
  `[hmr:expo-ios]` appears and the page updates without another Expo Prebuild or
  Xcode build; record the HMR time.
- [ ] `EXPO-04` Open `/__absolute/native`, edit its generated source only for
  this test, and confirm Metro Fast Refresh updates the React Native screen.
  Restore the file by stopping and restarting `bun dev`; confirm CNG regenerates
  it from AbsoluteJS ownership.
- [ ] `EXPO-05` Stop `bun dev`, run
  `bunx absolute mobile sync --yes --config absolute.config.ts` without manually
  exporting any `ABSOLUTE_EXPO_*` environment variable, and confirm the fresh
  production Android manifest/config does not reference
  `absolutejs_dev_ca` or `absolutejs_dev_network_security`. On this iOS-only Mac
  run, it is acceptable for Android to be absent. To inspect the resolved Expo
  config, run the following from the application root and confirm its `plugins`
  output omits `withAbsoluteDevelopmentCa`:

  ```sh
  cd /absolute/path/to/the/staging-application/.absolutejs/mobile/expo
  bunx expo config --type prebuild
  ```
- [ ] `EXPO-06` Optional physical-device check: rerun Terminal 1 with
  `--ios-device "DEVICE_IDENTIFIER"`, open the printed tokenized CA URL on the
  device, install and fully trust the profile, and confirm the HTTPS route and
  `[hmr:expo-ios]` update work. Stop the command and verify that the enrollment
  URL no longer responds. Record `SKIPPED — no dedicated iOS development
  device` if unavailable.
- [ ] `EXPO-07` In the application-owned config, map existing ordinary page URLs
  `/products/:productId` and `/files/*` to disposable native React modules under
  the application root. Type those modules with `AbsoluteNativeRouteProps` as
  shown in the next section. Restart Terminal 1, follow ordinary AbsoluteJS
  links to `/products/test-product`, `/files/one`, and `/files/one/two`, and
  confirm all three render native UI with the expected sanitized `params`.
  Also open the product URL through the configured custom scheme and confirm
  cold deep-link ownership selects the same native route.
- [ ] `EXPO-08` Remove only `/products/:productId` from
  `mobile.routes.native`, restart Terminal 1, and confirm its generated
  `.absolutejs/mobile/expo/app/products/[productId]/index.tsx` wrapper is gone.
  Confirm the application-owned module still exists and `/products/test-product`
  now falls back to the ordinary AbsoluteJS web route. Restore the config after
  recording the result.

Return the sanitized Terminal 1 output and the eight result rows. Never return
the CA private key, Apple credentials, provisioning profiles, raw device logs,
or the contents of environment files.

#### Expo typed page-props acceptance

Run these checks from the same staging application root and Terminal 1 session
as `EXPO-01`. Choose a disposable existing AbsoluteJS GET page route that has
visible, non-secret server props and export that page's existing props type. Do
not create a second JSON endpoint. Do not put a bearer token, cookie, refresh
credential, or manual `fetch` call in the native module.

Create an application-owned native module using the application's real type and
path names. This example assumes the ordinary page exports `ProductPageProps`:

```tsx
import type { AbsoluteNativeRouteProps } from '@absolutejs/absolute/mobile';
import type { ProductPageProps } from '../../src/pages/Product';
import { Pressable, Text, View } from 'react-native';

type ProductParams = { productId: string; view?: string };

export default function ProductNative({
  pageProps,
  params,
  reload
}: AbsoluteNativeRouteProps<ProductPageProps, ProductParams>) {
  return (
    <View>
      <Text testID="server-title">{pageProps.title}</Text>
      <Text testID="route-id">{params.productId}</Text>
      <Text testID="query-view">{params.view ?? 'default'}</Text>
      <Pressable testID="reload" onPress={reload}>
        <Text>Reload</Text>
      </Pressable>
    </View>
  );
}
```

Map that module to the same URL in `mobile.routes.native`, restart `bun dev`,
and complete each item. If the staging route uses different prop fields, change
only the JSX field names to match its existing exported type.

- [ ] `EXPO-DATA-01` From the application root run `bunx absolute mobile init
  --no-native --yes --config absolute.config.ts`, then run `bunx tsc --noEmit`
  from `.absolutejs/mobile/expo`. Confirm the generated wrapper and the
  application-owned module compile without a local duplicate props interface.
- [ ] `EXPO-DATA-02` Open `/products/test-product?view=compact` in the running
  development client. Confirm native UI shows the exact server-produced title,
  `test-product`, and `compact`; confirm the ordinary page handler logs exactly
  one GET for the load.
- [ ] `EXPO-DATA-03` Change a harmless server-produced title value, save, and tap
  **Reload**. Confirm the native screen receives the new value without editing
  the native module, running Expo Prebuild, or rebuilding with Xcode. Record the
  elapsed reload time.
- [ ] `EXPO-DATA-04` Temporarily rename the rendered `title` field in the
  existing exported page-props type and ordinary page producer, but do not
  update the native JSX. Confirm TypeScript identifies the stale native field
  access. Revert this disposable change after recording the compiler result.
- [ ] `EXPO-DATA-05` If the route is protected, sign in through the ordinary
  Expo Auth flow and open both the web and native renderers. Confirm both show
  the same disposable principal and that the native module contains no Auth
  adapter import or token handling. If Auth is not configured, record
  `SKIPPED — no protected staging route`.
- [ ] `EXPO-DATA-06` Stop the staging server, open or reload the native route,
  and confirm the generated error UI appears without exposing a response body
  or credential. Restart the server, tap **Try again**, and confirm recovery
  without remounting or rebuilding the app.
- [ ] `EXPO-DATA-07` From the application root run `bunx absolute prepare
  src/backend/server.ts --config absolute.config.ts`, then `bunx absolute mobile
  sync --yes --config absolute.config.ts`. Confirm generated
  `src/generated/webAssets.ts` contains only the expected public production
  origin plus release/page identifiers and contains no tokens, cookies,
  environment values, or page-props data.
- [ ] `EXPO-DATA-08` From `.absolutejs/mobile/expo`, run `bunx tsc --noEmit` and
  `bunx expo export --platform ios --output-dir dist-data-acceptance`. Confirm
  both succeed. Return to the application root before continuing with any other
  AbsoluteJS command; remove only the disposable export directory afterward.

Return the eight `EXPO-DATA` rows with PASS/FAIL/SKIPPED, the sanitized server
request count, reload timing, TypeScript diagnostic from the deliberate change,
and the final two command summaries. Do not return props containing personal or
secret staging data.

#### Expo device-capability acceptance

Run every command below from the staging application root, not from
`.absolutejs/mobile/expo`. Add a disposable ordinary AbsoluteJS test route that
imports capabilities from `@absolutejs/devices`; do not import
`@absolutejs/devices-expo` or any `expo-*` module. Give the route separate
buttons so permission requests occur only after a tap.

```ts
import {
  camera, clipboard, documents, haptics, keyboard, localNotifications,
  location, photos, pushNotifications, share, systemBars
} from '@absolutejs/devices';
```

From Terminal 1:

```sh
cd /absolute/path/to/the/staging-application
bunx absolute dev src/backend/server.ts --config absolute.config.ts
```

Accept the generated dependency installation if prompted. Keep Terminal 1
running and use only disposable text, files, and accounts.

- [ ] `EXPO-DEVICES-01` Confirm the generated package contains exact
  `@absolutejs/devices@0.7.0` and `@absolutejs/devices-expo@0.0.2`, plus only
  Expo modules needed by imports. Confirm `app.json` has corresponding CNG
  plugins and human-readable iOS descriptions.
- [ ] `EXPO-DEVICES-02` From `.absolutejs/mobile/expo`, run
  `bunx expo install --check`; confirm dependencies are up to date, then return
  to the application root.
- [ ] `EXPO-DEVICES-03` In the embedded route, write/read clipboard, invoke
  haptics, dismiss the keyboard, change system-bar appearance, and open Share.
  Confirm the same route still uses standards fallbacks as a web page.
- [ ] `EXPO-DEVICES-04` Query camera permission with no prompt, then request it
  by tap and observe one prompt. Take a photo where supported; otherwise report
  `SKIPPED — Simulator camera` and test scoped photo selection. Confirm the
  picker does not request full-library permission.
- [ ] `EXPO-DEVICES-05` Pick a disposable text/PDF file, export a generated
  document, and preview/open one. Confirm names, MIME types, and byte counts;
  confirm no native file path appears in the page or logs.
- [ ] `EXPO-DEVICES-06` Query location permission with no prompt, request by
  tap, read one position, and start/stop a watch. Confirm no event after stop.
  Report only accuracy class and event count, never coordinates.
- [ ] `EXPO-DEVICES-07` Query notification permission with no prompt, request
  by tap, schedule/cancel a local notification, and confirm received/action
  events are delivered once.
- [ ] `EXPO-DEVICES-08` With disposable Auth configured, enable push. On iOS
  Simulator report `SKIPPED — remote push requires physical device`; on a
  physical device confirm registration reaches the trusted server and the page
  never receives an APNs/FCM token. Sign out and confirm installation removal.
- [ ] `EXPO-DEVICES-09` Relaunch signed in with push permission granted. Confirm
  native registration refreshes without another prompt or duplicate server row.
- [ ] `EXPO-DEVICES-10` Save an ordinary route edit and record
  `[hmr:expo-ios]`; confirm no CNG, CocoaPods, or Xcode rebuild. Add one new
  device capability import, restart once, accept its package, and confirm one
  CNG/native rebuild.
- [ ] `EXPO-DEVICES-11` Leave a photo/document picker open longer than ten
  seconds before choosing; confirm completion. Cancel one and confirm a bounded
  cancellation result rather than a hung request.
- [ ] `EXPO-DEVICES-12` Inspect sanitized bridge traffic and confirm binary
  data is chunked, native diagnostic objects/paths do not cross, and an unknown
  `devices.*` method fails closed. Do not return raw payloads.

Return the twelve report rows with PASS/FAIL/SKIPPED and sanitized timing or
event-count evidence. Redact coordinates, provider tokens, payload contents,
file contents, and personal data. A physical-device-only skip does not block
the Simulator handoff.

#### Expo Auth acceptance

Run these checks from the same application root as `EXPO-01`; do not run them
from `.absolutejs/mobile/expo`. The staging application must depend on
`@absolutejs/auth`, mount its OIDC provider, and expose an ordinary route plus an
application-owned native React route that both call `createAuthClient()`.
Neither route may import `@absolutejs/auth-expo`, Expo WebBrowser/SecureStore, or
read an Authorization header. Start the application from Terminal 1:

```sh
cd /absolute/path/to/the/staging-application
bunx absolute dev src/backend/server.ts --config absolute.config.ts
```

- [ ] `EXPO-AUTH-01` Confirm the generated Expo `package.json` contains exact
  `@absolutejs/auth@0.75.6` and `@absolutejs/auth-expo@0.0.2` dependencies plus
  Expo SecureStore and WebBrowser. Confirm `app.json` includes the SecureStore
  config plugin. Do not edit either generated file.
- [ ] `EXPO-AUTH-02` From an ordinary embedded AbsoluteJS route, initiate sign-in
  through `createAuthClient().signIn.email(...)`. Confirm the system browser
  opens and no password form or credential is submitted inside the WebView.
- [ ] `EXPO-AUTH-03` Complete sign-in. Confirm the custom-scheme callback returns
  to the same app, the route reports the expected user, and no URL is copied
  manually. Cancel a second sign-in and confirm the UI receives a bounded error
  instead of remaining pending.
- [ ] `EXPO-AUTH-04` Call a protected same-origin endpoint through ordinary
  `@absolutejs/http` with GET and a small JSON POST. Confirm both succeed. Attempt
  another origin and an application-supplied Authorization header; both must
  fail before that destination receives a request.
- [ ] `EXPO-AUTH-05` Open the application-owned native React route and call the
  same `createAuthClient().status()` API. Confirm it reports the same principal
  without importing the Expo adapter or opening another sign-in screen.
- [ ] `EXPO-AUTH-06` Enter `relaunch` in Terminal 1, reopen both routes, and
  confirm the authenticated user restores from native secure storage. Inspect
  WebView storage and bridge messages only for this disposable account; confirm
  no access token, refresh token, or Authorization header is present. Never put
  captured storage or messages in the returned report.
- [ ] `EXPO-AUTH-07` Expire or revoke only the access token in the staging
  backend, then make one protected request. Confirm native refresh rotates once,
  the request retries once after `401`, and both routes remain signed in.
- [ ] `EXPO-AUTH-08` Sign out from either route. Confirm both routes observe the
  null principal, the renewable credential is revoked/removed, relaunch remains
  signed out, and a later sign-in can use a different staging account safely.

Return only PASS/FAIL, sanitized timings, HTTP status classes, and whether the
native/embedded principals matched. Never return credentials, callback query
values, tokens, SecureStore contents, bridge payloads, or user profile data.

#### Expo Sync acceptance

Run every command in this section from the **staging application root**—the
directory containing its `package.json`, `absolute.config.ts`, and server
entry. Do not run these commands from `.absolutejs/mobile/expo`. The staging
application must depend on `@absolutejs/auth@0.75.6` and
`@absolutejs/sync@2.31.0`, mount Auth's OIDC provider and `syncSocket()`, and
have one ordinary embedded route plus one application-owned native React route
that use the normal `@absolutejs/sync` API. Neither route should import
`@absolutejs/sync-expo`.

In Terminal 1 on the Mac, run:

```sh
cd /absolute/path/to/the/staging-application
bunx absolute dev src/backend/server.ts --config absolute.config.ts
```

Accept the pinned generated dependency installation when prompted. Leave this
terminal running for `EXPO-SYNC-02` through `EXPO-SYNC-09`. Use a disposable
staging account and non-sensitive fixture rows only.

- [ ] `EXPO-SYNC-01` Confirm
  `.absolutejs/mobile/expo/package.json` contains exact
  `@absolutejs/sync@2.31.0` and `@absolutejs/sync-expo@0.0.2`, plus Expo SQLite,
  Network, BackgroundTask, TaskManager, SecureStore, and Updates. Confirm
  `.absolutejs/mobile/expo/app.json` lists the SQLite, BackgroundTask, and
  TaskManager config plugins. Do not edit either generated file.
- [ ] `EXPO-SYNC-02` Sign in, open the ordinary embedded route, create one
  fixture row while online, and confirm its Sync status reaches online with no
  pending mutation. Navigate to the native React route and confirm the same row
  is loaded through the ordinary provider-neutral Sync API.
- [ ] `EXPO-SYNC-03` Disable the Mac network, create a second fixture row in the
  embedded route, and confirm it remains visible with one pending mutation.
  Navigate to the native route and confirm the row restores from the shared
  native store. Navigate back and confirm it remains present. No server request
  should be required for these route transitions.
- [ ] `EXPO-SYNC-04` With the network still disabled, use Terminal 1's
  `relaunch` command. Reopen both routes and confirm the offline row and pending
  mutation survive process restart. Restore the network and confirm resume or
  connectivity recovery sends the mutation once, clears pending state, and
  does not duplicate the business effect.
- [ ] `EXPO-SYNC-05` Start a live collection in the embedded route and make a
  server-side fixture change. Confirm the native-owned socket connects and the
  route receives the update. Inspect only the names/shapes of bridge messages:
  confirm no bearer token, refresh token, socket ticket, Authorization header,
  or Auth query value crosses the WebView bridge. Do not save or return raw
  bridge payloads.
- [ ] `EXPO-SYNC-06` Queue a mutation, force the staging server to return one
  retryable failure, and then recover it. Confirm retry metadata survives route
  changes and relaunch, the mutation eventually settles once, and the UI never
  silently discards the write. Repeat with a controlled permanent/conflict
  response and confirm the app exposes its dead-letter/remediation state.
- [ ] `EXPO-SYNC-07` Sign out, sign in as a second disposable staging account,
  and confirm the first account's rows and pending mutations are not visible in
  either route. Switch back and confirm the original partition restores. Record
  only whether isolation passed; do not report principal identifiers.
- [ ] `EXPO-SYNC-08` Put the app in the background for at least 20 seconds,
  restore it, and toggle connectivity once. Confirm foreground/resume and
  reachable-network wake-ups reconnect and perform a bounded flush without
  duplicate sends. This is the correctness test; do not claim that the OS ran a
  scheduled background task.
- [ ] `EXPO-SYNC-09` On a physical iOS device, leave one pending disposable
  mutation and background the app for at least 15 minutes while power/network
  conditions permit background work. Confirm a best-effort headless request may
  settle it and that foreground resume settles it if iOS does not schedule the
  task. Record `SKIPPED — no physical iOS device` when unavailable; iOS
  Simulator cannot validate BackgroundTask execution.
- [ ] `EXPO-SYNC-10` Stop Terminal 1. From the staging application root run the
  following inspection commands, then return to the application root when they
  finish:

  ```sh
  cd /absolute/path/to/the/staging-application
  cd .absolutejs/mobile/expo
  bunx tsc --noEmit
  bunx expo prebuild --no-install --clean --platform ios
  cd /absolute/path/to/the/staging-application
  ```

  Confirm TypeScript and clean iOS CNG succeed, then confirm the generated
  `Info.plist` contains `BGTaskSchedulerPermittedIdentifiers` and
  `UIBackgroundModes` values for `fetch` and `processing`. Do not hand-edit the
  plist. Because `prebuild --clean` recreates generated native directories,
  rerun the normal `bunx absolute dev ...` command before additional testing.

Return the ten `EXPO-SYNC` report rows with PASS/FAIL/SKIPPED, sanitized timing,
pending/dead-letter counts, and whether native/embedded views matched. Never
return database contents, encryption keys, SecureStore values, credentials,
tokens, tickets, raw bridge frames, or personal account data.

#### Expo Remote Mac acceptance from Windows or Linux

This is a separate two-computer test. The **developer computer** is Windows,
WSL, or Linux and contains the staging application/source editor. The **Remote
Mac** runs Xcode and the Simulator; it does not need a manual application
checkout. If no second developer computer is available, mark `EXPO-REMOTE-01`
through `EXPO-REMOTE-08` as `SKIPPED — no second developer host`.

On the Remote Mac, enable Remote Login and verify full Xcode, a bootable iOS
Simulator runtime, and Bun are installed. Leave the Mac signed into its normal
desktop session so Simulator can launch. On the developer computer, open a
terminal in the staging application root—the directory containing
`package.json` and `absolute.config.ts`—and run:

```sh
cd /absolute/path/to/the/staging-application
ssh builder@REMOTE_MAC_HOST
bunx absolute mobile pair mac expo-test builder@REMOTE_MAC_HOST
bunx absolute mobile doctor ios --remote expo-test
```

Exit the interactive SSH shell after confirming it connects. Do not run the
remaining commands inside SSH and do not `cd` into `.absolutejs/mobile/expo`.
Keep `mobile.engine: 'expo'`, `mobile.platforms: ['ios']`, and `dev.https: true`
in the staging configuration. From the same developer-computer application
root, run:

```sh
ABSOLUTE_IOS_REMOTE=expo-test bunx absolute dev src/backend/server.ts \
  --config absolute.config.ts
```

Accept the local pinned Expo dependency installation if prompted. The expected
ownership is explicit: Bun, Metro, source watching, and both HMR logs run on the
developer computer; Expo CNG, Xcode, Simulator install, and launch run on the
Remote Mac.

- [ ] `EXPO-REMOTE-01` Pairing and `mobile doctor ios --remote expo-test` pass.
  Record only the profile name and Xcode version, never the SSH destination.
- [ ] `EXPO-REMOTE-02` The first development run reports a project sync, a
  content-addressed agent upload or hit, local Metro startup, remote Expo CNG,
  Xcode build/install, CA trust enrollment, and `Expo ios connected`. Record the
  total and `building-ios` timings.
- [ ] `EXPO-REMOTE-03` An ordinary AbsoluteJS web route loads over HTTPS in the
  Remote Mac Simulator. Confirm the terminal receives an `expo-ios` client and
  no certificate, ATS, or SSH-forward error appears.
- [ ] `EXPO-REMOTE-04` Edit an ordinary web route on the developer computer.
  Confirm `[hmr:expo-ios]` updates the remote Simulator without project sync,
  Expo Prebuild, or Xcode build. Record the HMR time.
- [ ] `EXPO-REMOTE-05` Edit an application-owned module listed in
  `mobile.routes.native`. Confirm Metro Fast Refresh updates the remote native
  screen without project sync or Xcode build. Do not edit generated CNG files.
- [ ] `EXPO-REMOTE-06` Stop the command with Ctrl-C, confirm both the Bun and
  Metro SSH forwards close, then rerun the identical command. Confirm the agent
  and Expo dependency caches report hits and record the warm-start time.
- [ ] `EXPO-REMOTE-07` During the warm run, disconnect SSH or temporarily stop
  Remote Login. Confirm the developer terminal reports failure, does not leave
  a false `ready` state, and Ctrl-C exits cleanly. Restore SSH and confirm the
  next run recovers without deleting either workspace.
- [ ] `EXPO-REMOTE-08` Optional physical-device run: append
  `--ios-device "DEVICE_IDENTIFIER"`, keep the device and Mac on the same LAN,
  enroll the printed CA, and confirm HTTPS web HMR plus native Fast Refresh use
  the two LAN relays. Otherwise record `SKIPPED — no dedicated device` for this
  row only.

Return the eight completed result rows plus sanitized developer-terminal logs.
Do not return SSH hostnames, usernames, source paths, UDIDs, CA material, Apple
credentials, or provisioning information.

### Automated physical-device acceptance and report

Leave the physical-device `bun dev` session running. In a second terminal at
the same project root, use the exact selector from `--ios-device`:

```sh
bunx absolute mobile test ios --device DEVICE_IDENTIFIER --report
```

For a paired Remote Mac, run the command on the Windows or Linux development
host. The default paired Mac is selected automatically; name a non-default
profile explicitly when needed:

```sh
bunx absolute mobile test ios --device DEVICE_IDENTIFIER --remote MAC_PROFILE --report
```

The command performs these steps in order:

- [ ] Confirms the selected `bun dev` instance was started with the identical
  `--ios-device` value. It refuses to test a different device accidentally.
- [ ] Requires `dev.https: true`; a physical HMR connection over HTTPS is the
  machine-observable proof that this launched app accepted the active
  development certificate path.
- [ ] Uses `devicectl` on the local or paired Remote Mac to confirm that the
  device is paired, available, unlocked for development, and exposes its app
  inventory.
- [ ] Confirms the configured bundle ID is installed, terminates the existing
  app process, launches it again, and waits for the `capacitor-ios` client to
  reconnect through `/hmr-status`.
- [ ] Records relaunch/reconnect timing and emits the
  `mobile:ios-device-conformance` telemetry event when telemetry is enabled.
- [ ] Writes `report.md` and `report.json` beneath
  `.absolutejs/mobile/test-reports`. The report uses the generic target
  `physical-device`; it does not retain the selector, UDID, device inventory,
  signing output, device logs, or a physical-device screenshot.

For the strongest HMR acceptance, add `--wait-for-hmr`, wait until the second
terminal asks for an edit, then save one visible page or CSS change:

```sh
bunx absolute mobile test ios --device DEVICE_IDENTIFIER --report --wait-for-hmr
```

This adds the correlated server/client HMR result and timing to the report.
AbsoluteJS intentionally does not mutate application or native source files to
manufacture this check. The tester controls the harmless edit and can verify the
visible result on the device.

Expected automated results in `report.md` are:

- [ ] `AUTO-SETUP-01`, `AUTO-DEV-01`, `AUTO-DEVICE-01`, and
  `AUTO-DEVICE-HTTPS-01` are `PASS`.
- [ ] `AUTO-HMR-01` is `PASS` when `--wait-for-hmr` was used; otherwise it is
  `NOT_RUN`.
- [ ] `AUTO-DEVICE-REMOTE-01` is `PASS` for a Remote Mac run and `SKIPPED` for a
  local Mac run.
- [ ] `AUTO-ARTIFACT-01` is `SKIPPED` because physical screen capture is
  intentionally manual; do not change it by scripting a screen capture.
- [ ] `DEVICEDEV-01` is prefilled `PASS` from the observed physical target.
  Complete `DEVICEDEV-02` through `DEVICEDEV-10` manually because each contains
  at least one signing UI, trust UI, visible rendering, Auth/Sync state, network
  interruption, native-edit, or cleanup assertion the CLI cannot honestly infer.

If the command fails before a report is written, fix the named preflight and
rerun it. Common fixes are unlocking the device, accepting Trust, enabling
Developer Mode, completing automatic signing in Xcode, starting `bun dev` with
the same selector, or installing/enabling full trust for the session CA. Do not
paste raw `devicectl`, Xcode, or device-console output into the report.

When the report succeeds:

- [ ] Open the printed `report.md` path and complete each remaining `NOT_RUN`
  row with `PASS`, `FAIL`, or `SKIPPED` plus sanitized evidence.
- [ ] Complete `DEVICEDEV-03` through `DEVICEDEV-10` using the detailed steps
  above. Do not mark a mixed row `PASS` unless every assertion in it passed.
- [ ] Visually inspect every file in the printed report directory.
- [ ] Confirm it contains no selector/UDID, credentials, signing material,
  private Sync data, exact coordinates, routes containing private data, or
  screenshots.
- [ ] Return the complete printed directory, not only `report.md`, and state the
  exact IDs of any `FAIL` or `SKIPPED` rows in the handoff message.

Simulator acceptance remains available in a second terminal with:

```sh
bunx absolute mobile test ios --report
```

The simulator command verifies that the app is installed and launchable,
confirms the native iOS HMR client through `/hmr-status`, and saves a simulator
screenshot with `report.md` and `report.json` in a timestamped directory under
`.absolutejs/mobile/test-reports`. The terminal prints the exact directory to
return. To choose a repository-local output directory for either target, pass
`--report .absolutejs/mobile/my-ios-report`.

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

### Provider-neutral Keyboard and System Bars acceptance checklist

Use this repository's `/native-system-ui` route. It imports only `keyboard` and
`systemBars` from `@absolutejs/devices`; do not import Capacitor, edit Xcode, or
branch on iOS. `light` and `dark` describe the system icon/text foreground, not
the application background.

- [ ] `SYSUI-01` Run `bunx absolute mobile sync ios`. Confirm it discovers
  `keyboard` and `systemBars`, offers exactly `@capacitor/keyboard@8.0.5`, and
  does not offer a separate Status Bar plugin. Rerun sync and confirm no prompt.
- [ ] `SYSUI-02` Inspect `Info.plist`. Confirm the AbsoluteJS-owned region sets
  `UIViewControllerBasedStatusBarAppearance` to `true` exactly once. Release
  doctor must pass without a manual Xcode edit.
- [ ] `SYSUI-03` Open `/native-system-ui` in the web preview. Query must report
  browser keyboard support when `VisualViewport` exists and emulated bar
  appearance. Visibility control must report `unsupported`, not a false pass.
- [ ] `SYSUI-04` In the iOS Simulator, focus the fixture input. Confirm exactly
  one visible event with a positive CSS-pixel height. Dismiss through the
  portable button and confirm one hidden event with height zero.
- [ ] `SYSUI-05` Repeat focus/dismiss five times and navigate away/back twice.
  Confirm there are no duplicate events or retained listeners.
- [ ] `SYSUI-06` Apply light and dark foreground appearances. Confirm status and
  navigation/gesture content remain legible against the acceptance page, then
  restore `automatic` by reloading the app.
- [ ] `SYSUI-07` Hide only the status bar, then show all bars. Confirm the app
  remains interactive, safe-area content is not clipped, and Android-only
  legacy background/overlay controls are absent from the generated project.
- [ ] `SYSUI-08` Repeat keyboard focus/dismiss, appearance, hide/show, rotation,
  background/resume, and process-death relaunch on the physical TestFlight
  device. Record sanitized timings and screenshots containing no typed secrets.

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

### Provider-neutral Local Notifications acceptance checklist

Use this repository's `/native-notifications` route. It imports only
`localNotifications` from `@absolutejs/devices`; do not import Capacitor, add a
runtime branch, or edit Xcode. The first portable contract intentionally covers
best-effort one-time notifications, not repeating schedules, critical alerts,
or exact delivery.

- [ ] `NOTIF-01` Run `bunx absolute mobile sync ios`. Confirm it discovers
  `localNotifications`, offers exactly
  `@capacitor/local-notifications@8.2.1`, and does not prompt again after an
  approved idempotent rerun.
- [ ] `NOTIF-02` Open `/native-notifications` in the web preview. Query must
  report `emulated`; the permission query must not prompt. Tap Schedule before
  permission and confirm `permission-required` with no browser prompt.
- [ ] `NOTIF-03` In the iOS Simulator, Query must not prompt. Tap Schedule
  before permission and confirm `permission-required`. Only the separate
  Request permission button may open the system prompt.
- [ ] `NOTIF-04` Deny the first permission request. Confirm the normalized
  denial, no second surprise prompt from Schedule, and recovery guidance through
  iOS Settings. Then grant notification permission in Settings and return.
- [ ] `NOTIF-05` Tap Schedule, immediately background the app, and wait at least
  eight seconds. Confirm one notification with the expected disposable title
  and body appears. Record approximate timing only; delivery is best-effort.
- [ ] `NOTIF-06` Schedule again, tap List pending before delivery, and confirm
  one matching numeric ID. Tap Cancel, list again, and confirm zero; no
  notification may appear after the original delivery time.
- [ ] `NOTIF-07` Schedule again, background the app, and tap the delivered
  notification. Confirm the existing app opens or resumes and reports
  `tap:20260826` without duplicate action listeners. Inspect the generated
  project and confirm there is no exact-alarm or critical-alert entitlement.
- [ ] `NOTIF-08` Repeat schedule, process termination before delivery, display,
  tap/resume, pending, and cancellation on the physical TestFlight device.
  Notification content and attached evidence must contain no credentials,
  tokens, private records, or customer data.

The provider is pinned to the complete official Capacitor 8.2.1 artifact. The
newer 8.3.x line changed permission behavior and is outside this tested
contract. AbsoluteJS projects Android display permission but deliberately does
not add `SCHEDULE_EXACT_ALARM` or `USE_EXACT_ALARM`.

### Provider-neutral native Push Notifications acceptance checklist

Use this repository's `/native-push` route. It imports only
`pushNotifications` from `@absolutejs/devices` and offers separate Query,
Request permission, Enable, and Disable controls plus sanitized received/action
events. It never displays, logs, returns, or persists an APNs token. Do not
import Capacitor or edit the native project by hand. The example's trusted
server mounts `auth({ push: ... })` with the Dispatch push lifecycle;
user, tenant, and topics are derived there.

- [ ] `PUSH-01` Run `bunx absolute mobile sync ios`. Confirm it discovers
  `pushNotifications`, offers exactly
  `@capacitor/push-notifications@8.1.2`, and does not prompt again after an
  approved idempotent rerun.
- [ ] `PUSH-02` Inspect the generated project. Confirm
  `AbsoluteJS.entitlements` contains the APNs environment entitlement, the app
  target references that file, and AppDelegate forwards successful and failed
  remote-notification registration to Capacitor. Rerun sync and confirm those
  managed regions do not duplicate.
- [ ] `PUSH-03` Open the page before signing in. Query must not prompt. Enable
  must not expose a provider token and must not create an anonymous server
  installation. Only Request permission may open the iOS permission prompt.
- [ ] `PUSH-04` Sign in through the existing system-browser PKCE flow, request
  permission explicitly, then Enable. Confirm the Auth route returns an opaque
  installation ID and Dispatch stores exactly one subscription under the
  server-derived user, tenant, and topics. Evidence must redact the APNs token.
- [ ] `PUSH-05` Relaunch and Enable again. Confirm token rotation updates the
  same installation instead of creating a duplicate. Sign out and confirm the
  authenticated removal happens before credentials are cleared and the native
  provider registration is disabled.
- [ ] `PUSH-06` Simulate failed sign-out cleanup by making the server
  temporarily unreachable, sign out, restore the server, and sign in as a
  different disposable account. Confirm the server rejects ownership of the
  stale installation, the shell retries once as a new installation, and no
  subscription moves between users.
- [ ] `PUSH-07` Send a disposable APNs notification through the configured
  Dispatch adapter while the physical app is foregrounded. Confirm one
  normalized received event containing notification data but no provider token.
  Background the app, send again, tap it, and confirm one normalized action
  event resumes or opens the app.
- [ ] `PUSH-08` Terminate the app, send again, and tap the delivered system
  notification. Confirm cold-launch routing works, no duplicate listeners fire,
  and an invalid/uninstalled provider token is retired by Dispatch. Record only
  sanitized subscription counts, provider message IDs, and timings.

Real APNs delivery requires a physical device, an App ID/provisioning profile
with Push Notifications enabled, and server-side APNs credentials. Those
credentials belong only in the Dispatch adapter's server environment. Never
place an APNs signing key in `absolutejs.config.ts`, the generated shell, the
native project, a report, or a screenshot.

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
3. Confirm the acceptance route reports `data-http="pass"`. It calls the
   protected `/__absolute/native-http` endpoint through the ordinary
   `@absolutejs/http` import. The route must receive the authenticated staging
   principal without importing Capacitor, reading a token, or supplying an
   `Authorization` header. In Safari Web Inspector, also attempt the same client
   call with an absolute URL on a different origin; it must fail with the typed
   `origin` code before any request reaches that destination. Record this as
   `HTTP-01` without recording credentials or response data.
4. Confirm Sync reaches ready state and receives its first authenticated
   snapshot.
5. Force the Sync connection to disconnect, then reconnect it. Confirm it
   reaches ready state again and catches up without another login prompt. The
   server must issue and consume a new single-use socket ticket for the second
   connection.
6. Enter `relaunch` in the `bun dev` terminal. Reopen the route and confirm the
   authenticated user is restored from iOS Keychain without entering
   credentials again. Sync must reconnect with another fresh ticket.
7. Stop and restart the backend while leaving the app installed. Confirm the
   page recovers when the backend returns rather than remaining permanently
   stale. If practical, repeat this on a physical device by disabling and
   restoring Wi-Fi.
8. While signed in and Sync is ready, disable network access. Make a supported
   serializable optimistic mutation, quit the app, and relaunch while still
   offline. Confirm the last confirmed rows and pending optimistic change are
   visible from SQLite without a server connection.
9. Restore the network. Sync must reconnect immediately with a fresh ticket,
   deliver the same stable operation ID, converge on the server result, and
   remove the outbox record. Verify in server/database logs that the business
   effect executed exactly once even if the acknowledgment was interrupted.
10. Sign out and relaunch. The previous account must not return, proving that
   native credentials were removed and its offline partition is locked. Sign in
   as a different staging account and confirm none of the previous account's
   cached rows or pending mutations are visible or replayed.
11. Sign back in as the original verified account. Its retained partition may
    become available again; it must be the same converged data, not an exposed
    raw subject identifier or a newly mixed account partition.
12. If the staging app exposes a conflict fixture, make an offline edit and
    advance the same server row from another client before reconnecting. Confirm
    the optimistic overlay rolls back, the operation appears as one typed
    `conflict` dead letter, and it does not retry forever. Open the development
    `Sync` panel and retry it unchanged; confirm the original operation ID is
    preserved. Repeat the fixture, choose `Rebase with new args`, and confirm a
    new operation ID supersedes the old one. Finally repeat and discard it;
    confirm SQLite follows each explicit choice.
13. Use a fixture whose generated `localData` marks one collection and mutation
    `sensitivity: "private"` with `protection: "required"`. After foreground
    Sync writes them, inspect the app's SQLite `record_json` values from Xcode or
    a copied container. They must contain `__absoluteSyncProtected` and must not
    contain a distinctive fixture secret, row payload, or mutation argument.
14. Relaunch offline and confirm the protected rows/outbox still hydrate. Run
    the finite background task and confirm its pull/settlement remains readable
    afterward, proving Swift uses the foreground codec and Keychain key.
15. Tamper with one ciphertext byte in a disposable test installation. Reading
    it must fail closed; it must never return partial/plain data or silently
    replace the record. Delete/reinstall the test app after recording the result.
16. Exercise a very small test quota with disposable and critical projections.
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

### Generated Sync schema migration and rollback acceptance

Run this after `AUTH-01` and `SYNC-01` on a disposable staging installation.
Keep the bundle ID unchanged and never uninstall, clear app data, or delete the
app container between builds. Each replacement must use a higher iOS build
number. Save the original `package.json` first and restore it after the test.

1. With no application schema metadata (the generated app baseline is v1), sign
   in, receive a confirmed `tasks` row shaped like `{ id, label }`, create one
   deliberately unacknowledged serializable mutation, and relaunch. Record that
   Auth, the confirmed row, and pending count all restore.
2. Add this temporary application metadata to `package.json`:

   ```json
   {
     "absolutejs": {
       "sync": {
         "localSchema": {
           "version": 2,
           "migrations": [
             {
               "toVersion": 2,
               "operations": [
                 {
                   "type": "rename-field",
                   "collection": "tasks",
                   "from": "label",
                   "to": "id"
                 }
               ]
             }
           ]
         }
       }
     }
   }
   ```

3. Run `bunx absolute mobile sync ios`, build with a higher build number, and
   install it over v1. In Safari Web Inspector evaluate:

   ```js
   Reflect.get(
     globalThis,
     Symbol.for('absolutejs.mobile.sync.schema-state')
   )
   ```

   `MIGRATE-01` expects `{ state: 'failed', code: 'INVALID_PLAN' }`. Version
   fields may be absent for a row-level collision. Do not record error messages,
   rows, database contents, credentials, or field payloads.
4. Change only the migration target from `"id"` to `"title"`. Synchronize,
   increment the build number again, and install over the failed build without
   clearing data.
5. The same inspector expression must reach `state: 'ready'` with
   `storedVersion: 2` and `targetVersion: 2`. Reopen the ordinary Auth/Sync route
   and confirm Auth restores and the pending operation is still present. This is
   `MIGRATE-02`: the corrected migration could not succeed if the failed
   transaction had advanced the ledger or partially renamed the persisted row.
6. Restore the original `package.json`, run Sync again, and do not ship either
   temporary migration fixture. Keep the app installed until the report is
   complete in case sanitized follow-up evidence is needed.

Report the three build numbers, the typed failure code, the final stored/target
versions, restored Auth result, and pending count. Never attach the SQLite file,
Keychain contents, raw Web Inspector console, or application rows.

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
application, the opt-in real simulator gate runs both the development lifecycle
and embedded production-bundle suites:

```sh
bun run test:native:ios
```

To rerun only one suite while diagnosing a failure, use
`bun run test:native:ios:lifecycle` or `bun run test:native:ios:bundle`. The
production suite uses a bounded test-only reporter inside the generated fixture
bundle to observe the real Capacitor WebView; that reporter is never added to
application or published runtime code. The gate intentionally runs only on
macOS with Xcode and can take several minutes on its first build. Preserve
`.absolutejs/mobile-native-conformance` between runs so the warm-cache
measurement is meaningful.

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
bunx absolute mobile doctor release --json > absolute-mobile-compliance.json
bunx absolute mobile build ios
```

Run these commands from the staging application root identified in Track B,
not from the AbsoluteJS framework checkout. Return
`absolute-mobile-compliance.json` with the partner report. It intentionally
contains no local paths, detailed failure text, credentials, signing
fingerprints, account/device identifiers, or environment values. A passing
report still lists manual review for physical-device behavior, store privacy
questionnaires, policy, signing-key custody, and third-party native SDK data
practices.

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
- AbsoluteJS version: 0.20.0-beta.48
- Auth version: 0.75.6
- Dispatch version: 0.9.0
- Sync version: 2.31.0
- Sync Capacitor version: 0.9.2
- Capacitor SQLite version: 8.1.1
- Devices version: 0.7.0
- Devices Capacitor version: 0.8.0
- Devices Expo version: 0.0.2
- Keyboard version: 8.0.5
- Push Notifications version: 8.1.2
- Local Notifications version: 8.2.1
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
| PREVIEW-01 |  | controls / entry route: |  |
| PREVIEW-02 |  | iOS / Android / safe areas: |  |
| PREVIEW-03 |  | normal route / deep link: |  |
| PREVIEW-04 |  | Wi-Fi / cellular / offline / HMR: |  |
| PREVIEW-05 |  | lifecycle sequence / duplicate count: |  |
| PREVIEW-06 |  | Back / keyboard / permissions: |  |
| PREVIEW-07 |  | HMR server / client / state: |  |
| PREVIEW-08 |  | overlay / recovery / web isolation: |  |
| DEV-01 |  | cold: / warm: |  |
| DEV-02 |  | HMR: / relaunch: |  |
| HTTPS-01 |  | mkcert / CA trust / load / HMR: |  |
| EXPO-01 |  | generated CNG ownership / clean prebuild: |  |
| EXPO-02 |  | Simulator CA trust / HTTPS load / native build: |  |
| EXPO-03 |  | web HMR timing / no native rebuild: |  |
| EXPO-04 |  | Metro Fast Refresh / regeneration: |  |
| EXPO-05 |  | production prebuild trust isolation: |  |
| EXPO-06 |  | physical CA enrollment / HTTPS HMR / cleanup or skipped: |  |
| EXPO-07 |  | parameter/wildcard link + deep-link ownership: |  |
| EXPO-08 |  | stale-wrapper pruning / web fallback / source preservation: |  |
| EXPO-DATA-01 |  | generated + application TypeScript: |  |
| EXPO-DATA-02 |  | server props / path / query / GET count: |  |
| EXPO-DATA-03 |  | reload timing / no native rebuild: |  |
| EXPO-DATA-04 |  | shared props-type diagnostic: |  |
| EXPO-DATA-05 |  | matching Auth principal / no token code or skipped: |  |
| EXPO-DATA-06 |  | bounded error / retry recovery: |  |
| EXPO-DATA-07 |  | embedded public release metadata / no secrets: |  |
| EXPO-DATA-08 |  | TypeScript / iOS Metro export: |  |
| EXPO-DEVICES-01 |  | exact packages / generated CNG policy: |  |
| EXPO-DEVICES-02 |  | Expo dependency check: |  |
| EXPO-DEVICES-03 |  | clipboard / haptics / keyboard / bars / share: |  |
| EXPO-DEVICES-04 |  | explicit camera permission / scoped picker: |  |
| EXPO-DEVICES-05 |  | document transfer / no path exposure: |  |
| EXPO-DEVICES-06 |  | location permission / watch cleanup: |  |
| EXPO-DEVICES-07 |  | local notification / action count: |  |
| EXPO-DEVICES-08 |  | push registration / sign-out teardown: |  |
| EXPO-DEVICES-09 |  | relaunch registration / duplicate count: |  |
| EXPO-DEVICES-10 |  | web HMR / capability-add native rebuild: |  |
| EXPO-DEVICES-11 |  | long picker / cancellation recovery: |  |
| EXPO-DEVICES-12 |  | bounded bridge / field stripping / deny: |  |
| EXPO-AUTH-01 |  | exact packages / CNG plugin: |  |
| EXPO-AUTH-02 |  | system browser / no WebView credential entry: |  |
| EXPO-AUTH-03 |  | callback / cancellation recovery: |  |
| EXPO-AUTH-04 |  | authenticated GET+POST / origin+header rejection: |  |
| EXPO-AUTH-05 |  | native route / matching principal: |  |
| EXPO-AUTH-06 |  | relaunch restore / no credential bridge exposure: |  |
| EXPO-AUTH-07 |  | refresh rotation / one 401 retry: |  |
| EXPO-AUTH-08 |  | cross-engine sign-out / account switch: |  |
| EXPO-SYNC-01 |  | exact packages / CNG plugins: |  |
| EXPO-SYNC-02 |  | online embedded/native row match: |  |
| EXPO-SYNC-03 |  | offline shared store / pending count: |  |
| EXPO-SYNC-04 |  | restart durability / reconnect settlement: |  |
| EXPO-SYNC-05 |  | live socket / secret-free bridge: |  |
| EXPO-SYNC-06 |  | retry / conflict remediation / duplicates: |  |
| EXPO-SYNC-07 |  | account partition isolation: |  |
| EXPO-SYNC-08 |  | resume / connectivity wake / duplicates: |  |
| EXPO-SYNC-09 |  | physical background acceleration or skipped: |  |
| EXPO-SYNC-10 |  | TypeScript / clean iOS CNG / plist: |  |
| EXPO-REMOTE-01 |  | pair / remote doctor: |  |
| EXPO-REMOTE-02 |  | cold sync / build / trust / timings: |  |
| EXPO-REMOTE-03 |  | HTTPS route / expo-ios connection: |  |
| EXPO-REMOTE-04 |  | web HMR / no remote rebuild: |  |
| EXPO-REMOTE-05 |  | native Fast Refresh / no remote rebuild: |  |
| EXPO-REMOTE-06 |  | tunnel cleanup / warm cache timing: |  |
| EXPO-REMOTE-07 |  | interrupted SSH failure / recovery: |  |
| EXPO-REMOTE-08 |  | physical dual relay or skipped: |  |
| DEVICEDEV-01 |  | selected physical target / no Simulator dependency: |  |
| DEVICEDEV-02 |  | signed build / install / launch: |  |
| DEVICEDEV-03 |  | CA enrollment / full trust / endpoint cleanup: |  |
| DEVICEDEV-04 |  | HTTPS load / HMR timing / no native build: |  |
| DEVICEDEV-05 |  | redacted console / device state: |  |
| DEVICEDEV-06 |  | relaunch / HMR reconnect / state restore: |  |
| DEVICEDEV-07 |  | warm cache / native edit rebuild count: |  |
| DEVICEDEV-08 |  | network loss / latest HMR / overlay recovery: |  |
| DEVICEDEV-09 |  | interrupted rebuild / projection repair / doctor: |  |
| DEVICEDEV-10 |  | Remote Mac relay or reason skipped: |  |
| CAP-01 |  | discovered: / installed: |  |
| SYSUI-01 |  | discovered / exact package / idempotent sync: |  |
| SYSUI-02 |  | Info.plist value / release doctor: |  |
| SYSUI-03 |  | web keyboard / appearance / visibility boundary: |  |
| SYSUI-04 |  | visible height / hidden event: |  |
| SYSUI-05 |  | repetitions / duplicate listener count: |  |
| SYSUI-06 |  | light / dark / automatic legibility: |  |
| SYSUI-07 |  | targeted hide / restore / safe area: |  |
| SYSUI-08 |  | physical lifecycle / rotation / relaunch: |  |
| FILES-01 |  | discovered packages / idempotent sync: |  |
| FILES-02 |  | manifest reason / target membership: |  |
| FILES-03 |  | web pick / download / preview: |  |
| FILES-04 |  | iOS cancel / selected metadata: |  |
| FILES-05 |  | multi-select limit / path-free result: |  |
| FILES-06 |  | Save to Files / cancel recovery: |  |
| FILES-07 |  | native preview / cache cleanup: |  |
| FILES-08 |  | physical device pick / export / open: |  |
| NOTIF-01 |  | discovered package / idempotent sync: |  |
| NOTIF-02 |  | web query / no implicit prompt: |  |
| NOTIF-03 |  | iOS query / explicit prompt only: |  |
| NOTIF-04 |  | denial / no surprise prompt / Settings recovery: |  |
| NOTIF-05 |  | best-effort display / approximate timing: |  |
| NOTIF-06 |  | pending count / cancel result: |  |
| NOTIF-07 |  | tap event / duplicate count / no exact entitlement: |  |
| NOTIF-08 |  | physical device process-death/display/tap/cancel: |  |
| PUSH-01 |  | discovered package / idempotent sync: |  |
| PUSH-02 |  | entitlement / AppDelegate forwarding / target membership: |  |
| PUSH-03 |  | unsigned query / explicit prompt / anonymous rejection: |  |
| PUSH-04 |  | opaque installation / derived ownership and topics: |  |
| PUSH-05 |  | rotation count / sign-out removal / native disable: |  |
| PUSH-06 |  | offline cleanup / account switch / ownership recovery: |  |
| PUSH-07 |  | foreground receipt / background action / duplicates: |  |
| PUSH-08 |  | cold launch / invalid-token retirement / sanitized timing: |  |
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
| HTTP-01 |  | trusted principal: / cross-origin rejection: |  |
| SYNC-01 |  | first ready: / reconnect: / offline result: |  |
| BGSYNC-01 |  | acknowledged/pulled counts: |  |
| MIGRATE-01 |  | failed build / typed code: |  |
| MIGRATE-02 |  | corrected build / schema versions / Auth / pending: |  |
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
- Universal HTTP trusted-origin/native-Auth request: PASS / FAIL
- Universal HTTP cross-origin rejection before provider fetch: PASS / FAIL
- First authenticated Sync snapshot: PASS / FAIL
- Sync disconnect/reconnect with a fresh ticket: PASS / FAIL
- Backend restart/offline recovery: PASS / FAIL
- Offline process-death cache/outbox recovery: PASS / FAIL
- Exactly-once replay after reconnect: PASS / FAIL
- Cross-account local partition isolation: PASS / FAIL
- Conflict dead-letter retention/remediation: PASS / FAIL / NOT RUN
- Native Sync devtools redaction/retry/rebase/discard: PASS / FAIL / NOT RUN
- Generated Sync v1-to-v2 installed migration: PASS / FAIL
- Failed migration rollback and corrected-build recovery: PASS / FAIL
- Device capability auto-discovery/install: PASS / FAIL
- Clipboard web/iOS behavior: PASS / FAIL
- Native share sheet: PASS / FAIL
- Physical-device haptics: PASS / FAIL
- Explicit camera permission denial/grant: PASS / FAIL
- Physical-device camera capture: PASS / FAIL
- Scoped photo picker without broad prompt: PASS / FAIL
- Provider-neutral Documents web/iOS behavior and cache cleanup: PASS / FAIL
- Provider-neutral Local Notifications permission/schedule/cancel/tap: PASS / FAIL
- Provider-neutral native Push registration/rotation/removal/receipt/action: PASS / FAIL
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

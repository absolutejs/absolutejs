# AbsoluteJS iOS and TestFlight macOS test runbook

This runbook validates the iOS release path shipped in
`@absolutejs/absolute@0.20.0-beta.2` and
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
bun add @absolutejs/absolute@0.20.0-beta.2 \
  @absolutejs/deploy@0.24.0 \
  @absolutejs/blob@0.5.2 \
  @capacitor/core@8.5.0 \
  @capacitor/app@8.1.1 \
  @capacitor/cli@8.5.0 \
  @capacitor/ios@8.5.0
```

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

```sh
bunx absolute mobile doctor ios
bunx absolute mobile sync ios
bunx absolute mobile doctor release
bunx absolute mobile build ios
```

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
- AbsoluteJS version: 0.20.0-beta.2
- Deploy version: 0.24.0
- App bundle ID (non-secret):
- Marketing version:
- Allocated build number:
- Internal TestFlight group:
- Signed IPA build: PASS / FAIL
- App Store upload and processing: PASS / FAIL
- TestFlight assignment: PASS / FAIL
- Physical-device install and cold launch: PASS / FAIL
- Exact retry reused the release/build: PASS / FAIL
- Web-only update allocated the next build and appeared on-device: PASS / FAIL
- Authentication/deep links/offline reconnect result:
- Relevant sanitized terminal output:
- App Store Connect error text, if any:
- Notes:
```

Do not include the `.p8` key, Issuer ID, JWTs, provisioning profiles, signing
certificates, or full environment dumps in the report.

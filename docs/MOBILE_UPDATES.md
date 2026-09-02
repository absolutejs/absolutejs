# Signed mobile updates

Status: Capacitor beta. Expo uses its own experimental update runtime until the
shared control-plane adapter is complete.

AbsoluteJS mobile updates replace the embedded web bundle without changing the
native application binary. Routes, page code, Auth calls, Sync calls, and device
calls do not change. A store build remains mandatory whenever native capabilities,
permissions, deep links, the shell bridge ABI, Auth identity, or the persisted Sync
schema changes.

## Policy boundary

This is a bug-fix, security-fix, and in-scope content delivery mechanism—not a
way to bypass store review for a new application purpose.

Apple's current agreement permits downloaded interpreted code only when it stays
within the application's intended and advertised purpose, does not bypass platform
security, and does not create another app store. App Review Guideline 2.5.2 is more
conservative and prohibits downloaded code that introduces or changes app
functionality. Every AbsoluteJS update therefore carries an explicit
`withinSubmittedPurpose: true` attestation and a `bug-fix`, `security`, or `content`
classification. The developer remains responsible for whether a particular change
needs store review.

Primary references:

- [Apple App Review Guidelines 2.5.2](https://developer.apple.com/app-store/review/guidelines/)
- [Apple Developer Program License Agreement, executable and interpreted code](https://developer.apple.com/support/terms/apple-developer-program-license-agreement/)
- [Expo runtime-version compatibility model](https://docs.expo.dev/eas-update/runtime-versions/)
- [Expo rollback model](https://docs.expo.dev/eas-update/rollbacks/)
- [Capacitor Android WebView asset-path implementation](https://github.com/ionic-team/capacitor/blob/main/android/capacitor/src/main/java/com/getcapacitor/plugin/WebView.java)

When uncertain, ship a normal App Store/Google Play build.

## Trust and activation model

```text
private ECDSA P-256 key (build host only)
        |
        v
signed immutable manifest ---- immutable, individually hashed files
        |                                      |
        +---------- @absolutejs/deploy --------+
                          |
              anonymous stable rollout cohort
                          |
                          v
            installed Capacitor application
              verify signature + native ABI
              download into app-private staging
              verify every byte before commit
                          |
                non-persistent WebView switch
                  /                     \
       first page renders          boot cannot complete
              |                           |
       cancel watchdog            native deadline expires
       persist new root           restore previous root now
                                          |
                                quarantine failed release
```

The signing private key is never put in application config, a mobile bundle, the
deployment registry, telemetry, or a device. Applications contain only one or more
ECDSA P-256 public keys. Provision the next public key in a store build before retiring
an old key.

The native-runtime fingerprint is generated automatically from:

- the application ID, engine, and AbsoluteJS shell ABI;
- exact device providers, Capacitor plugin versions, permissions, and privacy declarations;
- deep-link hosts and schemes;
- native Auth client configuration;
- the complete generated local Sync schema; and
- the update endpoint, channel, and trusted public-key set.

Page JavaScript, CSS, HTML, and ordinary static assets are intentionally outside
that fingerprint and can update. A fingerprint mismatch returns no update. The
application never attempts to guess whether incompatible native code might work.

## Configure an application

Generate an ECDSA P-256 key outside source control:

```bash
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out "$HOME/.config/absolutejs/mobile-update.pem"
openssl pkey -in "$HOME/.config/absolutejs/mobile-update.pem" -pubout -outform DER | openssl base64 -A
```

Put only the second command's public value in `absolute.config.ts`:

```ts
export default {
  mobile: {
    appId: 'com.example.product',
    appName: 'Product',
    server: { productionOrigin: 'https://api.example.com' },
    updates: {
      // Optional; defaults to 20 seconds and accepts 5–120 seconds.
      bootTimeoutMs: 20_000,
      channel: 'production',
      publicKeys: {
        'production-2026': 'BASE64_ECDSA_P256_SPKI_DER'
      }
    }
  }
};
```

The default manifest endpoint is
`https://api.example.com/__absolute/mobile/updates/production/update.json`.
`mobile init` and `mobile sync` offer to install the exact Capacitor Filesystem
plugin only when updates are configured. They also generate a native Android/iOS
boot watchdog. `absolute mobile doctor release` verifies that the generated
watchdog and its deadline match this config before a store build can ship.

Run these commands from the application root—the directory containing
`package.json` and `absolute.config.ts`:

```bash
bunx absolute mobile sync
bunx absolute mobile build android src/backend/server.ts
```

That store build provisions the public key and establishes its runtime
fingerprint.

## Build, publish, promote, and roll back

Build a signed update from unchanged AbsoluteJS application code:

```bash
bunx absolute mobile update build src/backend/server.ts \
  --classification bug-fix \
  --key-id production-2026 \
  --signing-key "$HOME/.config/absolutejs/mobile-update.pem" \
  --within-submitted-purpose
```

AbsoluteJS prints an immutable `amu_…` release directory. Publication starts at
5% unless `--rollout` is supplied:

```bash
bunx absolute mobile update publish .absolutejs/mobile/updates/amu_RELEASE \
  --registry mobile.release.ts

bunx absolute mobile update promote \
  --release amu_RELEASE --rollout 0.25 --registry mobile.release.ts

bunx absolute mobile update promote \
  --release amu_RELEASE --rollout 1 --registry mobile.release.ts
```

Roll back to a previously published update, or omit `--release` to return every
device to its embedded store build:

```bash
bunx absolute mobile update rollback \
  --release amu_PREVIOUS --registry mobile.release.ts

bunx absolute mobile update rollback --registry mobile.release.ts
```

## Deployment registry

`@absolutejs/deploy/mobile-update` implements the provider-neutral registry over
the same `BlobStore` contract as native AAB/IPA publishing:

```ts
import {
  createMobileUpdateHandler,
  createMobileUpdateRegistry
} from '@absolutejs/deploy/mobile-update';

const updateRegistry = createMobileUpdateRegistry({
  publicKeys: {
    'production-2026': 'BASE64_ECDSA_P256_SPKI_DER'
  },
  store
});
const updateHandler = createMobileUpdateHandler({
  appId: 'com.example.product',
  channel: 'production',
  registry: updateRegistry
});

export default updateRegistry;

// Mount this through the trusted AbsoluteJS server at the configured update path.
app.all('/__absolute/mobile/updates/production/*', ({ request }) =>
  updateHandler(request)
);
```

The registry verifies the signature before storing anything, stores immutable
manifests and assets, keeps the prior confirmed release as the staged-rollout
fallback, validates its own receipts, and assigns an anonymous installation UUID
deterministically. It does not use a user, Auth
principal, advertising identifier, device fingerprint, or credential.

The handler permits Capacitor's standard `capacitor://localhost` and
`https://localhost` origins by default. Supply `allowedOrigins` when the native
project deliberately uses another local origin. It never emits wildcard credential
CORS.

## Failure behavior

- An invalid signature, unknown signing key, changed manifest, path traversal,
  oversized file, truncated file, or SHA-256 mismatch aborts and removes staging.
- A runtime mismatch is treated as no compatible update; create a store build.
- The new root is not persisted until its first route has loaded and rendered.
- Activation arms native code before switching the WebView root. If the first route
  does not commit and paint within `bootTimeoutMs`, Android or iOS restores the exact
  previous root immediately. A process killed during activation is repaired before
  Capacitor loads on the next launch.
- A release recovered by the watchdog is quarantined on that installation and is
  not downloaded again. A different immutable release remains eligible, and a
  successfully confirmed release clears the old quarantine.
- A confirmed update is stored in `Library/NoCloud`/app-private storage. Generated
  iOS startup code clears a dangling Capacitor snapshot pointer after device
  migration so the embedded bundle remains the final recovery image.
- The `absolute:mobile-update` DOM event reports sanitized `boot-timeout` or
  `boot-interrupted` recovery reason, release identity, and duration. It never
  includes URLs, keys, paths, page data, Auth state, or downloaded bytes.

## Native conformance

On an Android development machine with AbsoluteJS's emulator prerequisites
installed, run:

```bash
bun run test:native:android:updates
```

The test builds and signs its own isolated releases with an ephemeral key, serves
them from the local trusted test backend, and drives a real Capacitor WebView. It
checks valid activation, automatic timeout rollback, quarantine/no-redownload,
replacement by a corrected release, and recovery from an ADB-forced process death.
It also verifies that native Auth, Sync's durable outbox, and local storage remain
intact. The test leaves a JSON result at
`.absolutejs/mobile-native-conformance/embedded-artifacts/android-update-conformance.json`;
on failure the same directory receives sanitized diagnostics and a screenshot.

## Current limitations

- Delta transfer is not implemented. Immutable files are fetched independently,
  which already avoids an archive/unzip dependency and permits CDN caching.
- Expo remains on its runtime-version/EAS-compatible adapter track. Expo updates
  must preserve the same native fingerprint, signature, rollout, and rollback
  invariants before AbsoluteJS exposes one shared command surface.

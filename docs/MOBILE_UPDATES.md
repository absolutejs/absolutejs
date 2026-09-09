# Signed mobile updates

Status: Capacitor and self-hosted Expo beta. Both engines use one AbsoluteJS
build/publish/promote/rollback control plane.

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
        |                         Expo RSA key (trusted server only)
        v                                      |
signed immutable manifest ---- immutable files + signed Expo response
        |                                      |
        +---------- @absolutejs/deploy --------+
                          |
              anonymous stable rollout cohort
                          |
                          v
       exact native-runtime/certificate match
                  /             \
         Capacitor client       Expo client
        verify signed files    verify RSA manifest + asset hashes
        native boot watchdog   native Expo recovery
```

Neither private key is put in application config, a mobile bundle, the deployment
registry, telemetry, or a device. Capacitor applications contain only ECDSA P-256
public keys. Expo applications additionally contain a public X.509 certificate;
its RSA private key exists only in the trusted update-serving process. Registry
admission and native client verification are independent, so compromising storage
or a CDN cannot produce an accepted Expo update.

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
      },
      // Expo only: this public certificate is safe to commit.
      expoCodeSigning: {
        certificatePath: 'mobile/code-signing/expo-update-certificate.pem',
        keyId: 'main'
      },
      server: {
        // Both are optional. The registry defaults to mobile.update.ts and
        // AbsoluteJS mounts it automatically on productionOrigin.
        registry: 'mobile.update.ts',
        expoPrivateKeyEnv: 'ABSOLUTE_EXPO_UPDATE_PRIVATE_KEY',
        // Optional overrides; fleet health and auto-pause default on.
        health: {
          failureRate: 0.2,
          minimumReports: 20,
          secretEnv: 'ABSOLUTE_MOBILE_UPDATE_HEALTH_SECRET'
        },
        // Opt-in. Defaults to manual advancement through 5%, 25%, and 100%.
        rollout: {
          automatic: false
        }
      }
    }
  }
};
```

The default manifest endpoint is
`https://api.example.com/__absolute/mobile/updates/production/update.json`.
Provision its trusted-server registry from the application root:

```bash
# Zero-configuration development and single-machine smoke tests.
bunx absolute mobile update provision --storage local --yes

# Required before a production deployment. Supports AWS S3, R2, MinIO,
# Backblaze B2, and other S3-compatible storage.
bunx absolute mobile update provision --storage s3 --force --yes
```

The first command generates `mobile.update.ts` with explicitly marked local
storage. AbsoluteJS serves it during development, but `mobile doctor release`
and the production runtime reject it. The durable form reads
`ABSOLUTE_MOBILE_UPDATE_HEALTH_SECRET`,
`ABSOLUTE_MOBILE_UPDATE_S3_BUCKET`, standard AWS credentials, and optional
`ABSOLUTE_MOBILE_UPDATE_S3_ENDPOINT` / `ABSOLUTE_MOBILE_UPDATE_S3_REGION` only
inside the trusted server. The generated file contains public verification keys
but no private key or storage credential.
Generate the health secret with at least 32 unpredictable characters and keep it
only on the trusted server. Local provisioning uses an explicitly non-production
fallback unless that environment variable is set. Set `server.health: false` to
disable health receipts and auto-pause together.
Set `ABSOLUTE_MOBILE_UPDATE_S3_FORCE_PATH_STYLE=1` only for providers such as a
local MinIO deployment that require path-style bucket URLs.

The production server and `mobile doctor release` do not trust the word
`durable` by itself. At startup they write a random short-lived probe, read and
compare it, and delete it. Missing buckets, invalid credentials, read-only
credentials, incorrect endpoints, and cleanup-denied policies therefore fail
before update traffic is accepted. Grant the update server `GetObject`,
`PutObject`, and `DeleteObject` for its bucket prefix.

Common provider settings are:

| Provider | Bucket | Region | Endpoint | Path style |
| --- | --- | --- | --- | --- |
| AWS S3 | `ABSOLUTE_MOBILE_UPDATE_S3_BUCKET` | Set the bucket's AWS region | Omit | Omit |
| Cloudflare R2 | Same | `auto` | Account-specific R2 S3 endpoint | Omit |
| MinIO | Same | Usually `us-east-1` | MinIO API origin | Set to `1` when required |
| Backblaze B2 | Same | B2 bucket region | Region-specific S3 endpoint | Omit unless required by the deployment |

Use the provider's standard AWS credential variables or workload identity. Do
not place access keys in `absolute.config.ts`, `mobile.update.ts`, a native
project, or a mobile update artifact.

`mobile init` and `mobile sync` offer to install the exact Capacitor Filesystem
plugin only when updates are configured. They also generate a native Android/iOS
boot watchdog. `absolute mobile doctor release` verifies that the generated
watchdog and its deadline match this config before a store build can ship.

For `mobile.engine: 'expo'`, the same config generates an exact Expo
`runtimeVersion`, configures `expo-updates`, and installs the internal update
controller. AbsoluteJS stores an anonymous installation UUID in Expo SecureStore,
adds it through Expo's protocol-defined extra parameters, and checks after startup
without exposing Expo APIs to application routes. Static request headers remain
identical for embedded and downloaded releases so Expo's native selection policy
can always retain the embedded recovery image. No Auth principal, advertising
identifier, or device fingerprint is used.

Normal launches use the generated AbsoluteJS controller, so a downloaded update
is applied deliberately with Expo's fetch-and-reload APIs. The generated native
config also uses `ON_ERROR_RECOVERY`: a bundle that fails before its first root
commit gives Expo one native recovery check even though routine automatic checks
remain disabled. An incompatible runtime receives `204 No Content`; an empty
channel alone receives Expo's rollback-to-embedded directive. Rolling back to a
previous OTA creates a fresh activation identity and timestamp without changing
the immutable release bytes, allowing Expo to recognize it as a newly selected
update.

For Expo, first generate the separate RSA key and public certificate through
AbsoluteJS. The private-key destination is deliberately required to be outside
the application; the certificate remains inside it so store builds can embed it:

```bash
bunx absolute mobile update signing generate \
  --private-key "$HOME/.config/absolutejs/product-expo-update.pem"
```

The command prints the exact `expoCodeSigning` config to add. It refuses to
overwrite existing material, writes the private key with owner-only permissions,
and defaults to a ten-year certificate. Run `absolute mobile sync` after adding
the config. Since the certificate is part of the automatically generated runtime
fingerprint, this correctly requires a new store build.

Provision the printed private key PEM as the value of
`ABSOLUTE_EXPO_UPDATE_PRIVATE_KEY` (or the configured
`expoPrivateKeyEnv`) in the trusted server's secret manager. AbsoluteJS checks
that it matches the embedded certificate before accepting update traffic. The
path to the key is never placed in application config.

Run these commands from the application root—the directory containing
`package.json` and `absolute.config.ts`:

```bash
bunx absolute mobile sync
bunx absolute mobile build android src/backend/server.ts
```

That store build provisions the public key and establishes its runtime
fingerprint.

## Build, publish, promote, and roll back

Build a signed update from unchanged AbsoluteJS application code. The command is
identical for Capacitor and Expo:

```bash
bunx absolute mobile update build src/backend/server.ts \
  --classification bug-fix \
  --key-id production-2026 \
  --signing-key "$HOME/.config/absolutejs/mobile-update.pem" \
  --within-submitted-purpose
```

AbsoluteJS prints an immutable `amu_…` release directory. Publication starts at
the configured first stage (5% by default) unless `--rollout` is supplied:

```bash
bunx absolute mobile update publish .absolutejs/mobile/updates/amu_RELEASE \
  --rollout 0.05

bunx absolute mobile update promote \
  --release amu_RELEASE --rollout 0.25

bunx absolute mobile update promote \
  --release amu_RELEASE --rollout 1
```

Publication stores files by their signed SHA-256 digest. If a later release uses
the same JavaScript, CSS, image, or other asset bytes, the registry references
the existing immutable content blob instead of uploading and storing another
copy. Existing release-scoped asset URLs remain valid, including for older app
clients and releases written before content-addressed storage was introduced.

Capacitor clients compare the signed target digest with the corresponding file
in the active, already-verified release. Matching files are copied into the new
staging transaction locally and only changed files cross the network. No file
inventory, page data, auth state, or Sync data is sent to the update server. The
Capacitor store also checkpoints response chunks in app-private persistent
storage. A process exit, lost connection, or failed request therefore resumes
with a conditional HTTP byte-range request instead of restarting completed files
or a partially transferred file. The server must return an exact `206
Content-Range`; a full `200` safely restarts that file, and any mismatched range
fails closed. Completed and partial staging bytes remain untrusted until their
signed size and SHA-256 digest pass.

Downloads use at most three concurrent asset requests by default, reduce that to
two on a reported 3G connection, and serialize on 2G or data-saver connections.
The `absolute:mobile-update` stream emits `download-progress` events and a final
`downloaded` event with `downloadedBytes`, `downloadedFiles`, `resumedBytes`,
`resumedFiles`, `reusedBytes`, `reusedFiles`, `avoidedBytes`, `completedFiles`,
`totalBytes`, `totalFiles`, `durationMs`, and `throughputBytesPerSecond`. These
aggregates contain no URL, local path, manifest, Auth/Sync value, or page data.
The staged release is still digest-checked file by file and activated atomically.
Expo retains its native update/cache protocol while sharing the registry's
content-addressed and byte-range-capable backing storage.

## Fleet health and automatic rollout protection

AbsoluteJS reports bounded `downloaded`, `download-failed`, `activated`,
`rolled-back`, and `quarantined` outcomes without application code. Capacitor
persists the reporting capability through activation and native watchdog
recovery; Expo keeps the pending identity in SecureStore and reconciles it on
the next launch. Reporting is best effort and never delays activation, rollback,
or foreground startup.

The manifest response issues an HMAC capability scoped to the exact application,
channel, anonymous installation UUID, runtime, release, and promotion generation.
The server rejects modified, cross-installation, stale-generation, and
cross-runtime reports. It stores only an HMAC pseudonym of the installation ID,
the bounded outcome, server timestamp, optional watchdog reason, and aggregate
transfer counters. It discards additional request fields and never accepts Auth,
Sync, page, route, cookie, bearer-token, filesystem-path, or device-profile data.

Inspect the active promotion from the application root:

```bash
bunx absolute mobile update status
bunx absolute mobile update status --json
```

The default guard waits for 20 distinct terminal installations and pauses the
exact promotion generation at a 20% rollback/quarantine rate. Ordinary network
download failures are visible but never pause a rollout. A pause makes new
resolution fall back to the prior release without rewriting the channel pointer;
re-promoting intentionally creates a fresh generation. Configure the sample and
rate under `mobile.updates.server.health`. Receipt capabilities prevent tampering
and replay inflation, but an anonymous installation is not hardware attestation;
production ingress must still enforce ordinary request/body rate limits.

When `server.rollout` is configured, AbsoluteJS freezes the normalized stage
plan into each new promotion generation. The recommended default stages require
20 terminal reports and one hour at 5%, then 100 cumulative terminal reports
and six hours at 25%, with no more than a 5% rollback/quarantine rate at either
gate. The final stage is 100%. Custom stages can set `rollout`,
`minimumReports`, `observationMinutes`, and `maximumFailureRate`; they must be
strictly increasing and end at 1. Every advancement minimum must be at least the
fleet auto-pause minimum, and its failure ceiling must be lower than the pause
threshold. `mobile update publish` defaults to the configured first stage, so a
custom plan does not require a matching CLI flag.

Advancement remains an explicit operator decision unless `automatic: true` is
configured:

```bash
# Inspect health, current stage, next gate, and control state.
bunx absolute mobile update status

# Advance exactly one qualifying stage. --rollout is an optional assertion.
bunx absolute mobile update advance --rollout 0.25

# Stop and later resume selection without changing the promotion generation.
bunx absolute mobile update pause
bunx absolute mobile update resume

# Permanently stop this generation, or ask an external scheduler to evaluate it.
bunx absolute mobile update cancel
bunx absolute mobile update reconcile
```

Both manual and automatic advancement enforce the same evidence, failure-rate,
and observation gates. Automatic evaluation occurs on trusted-server receipt of
terminal health evidence. A deployment scheduler may also run `reconcile`; it is
idempotent when the gate is not ready or another server already advanced it.
Stage advancements and operator controls are immutable promotion-scoped events,
so a stale server cannot lower the effective rollout. Concurrent pause/resume is
fail-safe: a resume acknowledges only the pauses it observed, while a concurrent
new pause remains active. Cancellation is terminal. Fleet-health pauses cannot
be resumed; they require an intentional re-promotion and fresh generation.

Roll back to a previously published update, or omit `--release` to return every
device to its embedded store build:

```bash
bunx absolute mobile update rollback \
  --release amu_PREVIOUS

bunx absolute mobile update rollback
```

## Storage accounting and retention

Inspect one application's update storage without changing it:

```bash
bunx absolute mobile update storage
bunx absolute mobile update storage --json
```

The report separates signed release manifests, shared content blobs, channel
documents, collection markers, incomplete uploads, and unrecognized objects. It reports
the stored and reclaimable byte counts and explains why each release is
retained. By default, the five newest releases per channel and every release
younger than 30 days are kept. Active releases and channel fallbacks are always
protected regardless of those settings.

Preview garbage collection with the same read-only defaults:

```bash
bunx absolute mobile update gc
bunx absolute mobile update gc --retain 10 --min-age-days 60
```

Applying the plan is deliberately two-phase:

```bash
# First application marks eligible releases. It deletes no release bytes.
bunx absolute mobile update gc --apply

# A later application sweeps marks older than the default seven-day grace period.
bunx absolute mobile update gc --apply
```

Use `--grace-days` to change the recovery window. A later policy that protects a
marked release automatically removes its marker. Promotion and rollback reject
a marked release until it is restored. Immediately before sweeping, AbsoluteJS
reloads every channel and rechecks active, fallback, age, and recent-release
protection. Release files are removed first and the immutable manifest last;
the collection marker remains if any deletion fails, making the next run
retryable. A content blob is swept only after no remaining release manifest
references its digest. Incomplete or unrecognized objects are accounted for but
never deleted automatically.

`--apply` is the only flag that mutates storage. `--json` makes either command
suitable for scheduled jobs, budgets, and deployment-platform dashboards.
Serialize publication and lifecycle jobs for the same application. The default
CLI workflow does this naturally; a custom deployment scheduler must not run
publish and garbage collection concurrently for one app.

## Deployment registry

`mobile.update.ts` is intentionally separate from `mobile.release.ts`: the first
serves web-bundle updates from the application runtime, while the second may
contain Google Play or App Store Connect release credentials used only by CI.
Both use `@absolutejs/deploy` and the provider-neutral `BlobStore` contract.
AbsoluteJS generates the normal update registry, imports it during server boot,
and mounts its handler before page and static routes. Advanced deployments can
set `server.autoMount: false` and host the exact manifest URL separately.

The generated durable module is equivalent to:

```ts
import { randomUUID } from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3';
import { awsS3BlobStore } from '@absolutejs/blob/aws-s3';
import { createMobileUpdateRegistry } from '@absolutejs/deploy/mobile-update';

export const absoluteMobileUpdateServer = {
  format: 1,
  provider: 's3',
  storage: 'durable'
} as const;

const bucket = process.env.ABSOLUTE_MOBILE_UPDATE_S3_BUCKET!;
const client = new S3Client({ region: 'us-east-1' });

export const verifyAbsoluteMobileUpdateServer = async () => {
  const key = `absolutejs/mobile-updates/_health/${randomUUID()}`;
  const expected = randomUUID();
  let stored = false;
  try {
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: expected }));
    stored = true;
    const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if ((await result.Body?.transformToString()) !== expected) {
      throw new Error('Durability probe read did not match its write.');
    }
  } finally {
    if (stored) await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }
};

const updateRegistry = createMobileUpdateRegistry({
  publicKeys: {
    'production-2026': 'BASE64_ECDSA_P256_SPKI_DER'
  },
  store: awsS3BlobStore({
    bucket,
    client
  })
});

export default updateRegistry;
```

The registry verifies the signature before storing anything, stores immutable
manifests and assets, keeps the prior confirmed release as the staged-rollout
fallback, validates its own receipts, and assigns an anonymous installation UUID
deterministically. It does not use a user, Auth
principal, advertising identifier, device fingerprint, or credential.

Immutable release files may be uploaded concurrently. Promotion and rollback
each replace one complete channel document atomically, so readers never observe
partial JSON or a release without its verified manifest. Operators should still
serialize intentional changes to the same app/channel: simultaneous control
commands are safe, but whichever complete channel write the object store orders
last becomes policy.

The handler validates each Expo RSA private key against its X.509 certificate at
startup and rejects invalid, expired, mismatched, or non-RSA material. When the
native client requests signing, it negotiates the key ID and
`rsa-v1_5-sha256`, signs the exact manifest or rollback-directive bytes, and
fails closed for missing or unsupported keys. The private key is never part of a
published update artifact; provision it from the deployment platform's secret
manager.

For rotation, update the active `expoCodeSigning` certificate/key ID and ship the
resulting native runtime through the stores. Retain each prior public certificate
and server-only environment reference under
`mobile.updates.server.expoCodeSigningKeys`; each installed binary requests its
own key ID. Retire an old entry only after that binary population is no longer
supported.

The handler permits Capacitor's standard `capacitor://localhost` and
`https://localhost` origins by default. Supply `allowedOrigins` when the native
project deliberately uses another local origin. It never emits wildcard credential
CORS.

For Expo, the build command runs a production `expo export` for iOS and Android,
validates every path in Expo's `metadata.json`, records the public Expo config,
and places the Metro launch bundles and assets inside the same signed immutable
AbsoluteJS release. The handler negotiates Expo Updates protocol v1 from the
standard `expo-*` request headers, returns only the matching platform and generated
runtime version, preserves deterministic rollout cohorts, and emits Expo's
`rollBackToEmbedded` directive for a channel rollback. A downloaded update is
applied by Expo on a later restart; Expo's native launcher retains its embedded
recovery update.

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
- Health-report failures never affect update integrity, startup, activation, or
  rollback. A fleet pause applies only to the failing promotion generation.

## Native conformance

On a development machine with the platform prerequisites installed, run either:

```bash
bun run test:native:android:updates
bun run test:native:ios:updates
```

The tests build and sign their own isolated releases, serve them from the local
trusted test backend, and drive a real Capacitor WebView. Android uses a stable
ignored test key so an unchanged native shell can reuse its installed APK. Its
first independently timed phase checks valid activation, automatic timeout
rollback, quarantine/no-redownload, replacement by a corrected release, recovery
from a verified ADB-forced process death, native Auth, Sync's durable outbox, and
local storage. Its second phase mounts the real `@absolutejs/deploy` registry and
checks 50% included/excluded cohorts, manual and automatic advancement to 100%,
concurrent advancement, pause/resume/cancel fallback, fleet-health auto-pause,
and terminal-report deduplication after restart. The Android command ends with
two passing tests. It leaves a JSON result at
`.absolutejs/mobile-native-conformance/embedded-artifacts/android-update-conformance.json`;
on failure the same directory receives sanitized diagnostics and a screenshot.

The iOS command runs the equivalent signed sequence in a real Simulator, verifies
the native UserDefaults watchdog state, terminates the app with `simctl` only after
activation is pending, and checks local-storage continuity. Its result is
`.absolutejs/mobile-native-conformance/ios-embedded-artifacts/ios-update-conformance.json`.
The iOS suite requires macOS and Xcode and is included in
`bun run test:native:ios`.

Expo has a separate, opt-in production Android OTA gate. Run it from the
AbsoluteJS repository root after `mobile doctor android` has prepared the
managed Android SDK and AVD:

```bash
bun run test:native:expo:android:updates
```

The gate launches or reuses the managed emulator, creates a clean Expo CNG
project, builds and installs a release APK, and uses an ephemeral registry-signing
key plus Expo code-signing certificate. It
proves healthy activation; rejection of invalid signatures, corrupt assets,
incompatible runtimes, and interrupted downloads; recovery from a fatal update
before its first root commit; activation of a later corrected release; rollback
to a previous OTA and to the embedded bundle; retained native Auth; exactly-once
Sync replay; and encrypted-at-rest SQLite/WAL bytes. The production APK stays
non-debuggable: storage inspection occurs inside its own sandbox and exports only
a boolean result. A passing artifact is written to
`.absolutejs/expo-android-update/artifacts/expo-android-update-conformance.json`.

## Current limitations

- Binary patch generation is not implemented. Content-addressed file reuse and
  resumable byte ranges avoid unchanged and previously transferred bytes without
  adding an archive/unzip or patch-application trust boundary.
- EAS-hosted publishing is not yet an AbsoluteJS registry provider. The current
  Expo path is the provider-neutral self-hosted `@absolutejs/deploy` registry.

## Durable storage conformance

AbsoluteJS includes an opt-in production-storage gate using a pinned MinIO
container:

```bash
bun run test:mobile:update:durable
```

Run it from the AbsoluteJS repository root on a machine with Docker. It creates
an ephemeral bucket and proves generated-registry health verification,
independent server instances, health evidence across a MinIO restart, incomplete
publication isolation, concurrent channel-state safety, previous-release and
embedded rollback, HTTP byte ranges and interruption resume, Capacitor
digest/signature verification, Expo RSA response signing, promotion-scoped
receipt authentication, health-probe cleanup,
and failure for invalid credentials or a missing bucket. It removes the container
and temporary project afterward.

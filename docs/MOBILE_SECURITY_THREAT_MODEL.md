# AbsoluteJS Capacitor mobile security threat model

Status: implemented release baseline for Capacitor v1

This document defines the security boundary enforced by AbsoluteJS mobile
builds and `absolute mobile doctor release`. It is a framework threat model,
not a substitute for reviewing an application's own routes, native extensions,
data practices, dependencies, infrastructure, or legal obligations.

## Security objective

An installed AbsoluteJS application must execute immutable UI code embedded in
the signed native application, obtain dynamic data only from its configured
HTTPS AbsoluteJS server, and expose native capabilities only through generated,
audited providers. A compromised page response must not be able to replace the
native shell, redirect credentials, or silently expand native permissions.

AbsoluteJS does not place Bun, Elysia, server secrets, databases, signing keys,
OAuth client secrets, refresh tokens, or push-provider credentials in the web
bundle. The deployed server remains the trusted execution boundary for route
handlers and authorization.

## Trust boundaries

1. **Signed native container.** Xcode/Gradle projects, entitlements, manifests,
   Capacitor plugins, and the embedded web bundle are trusted only after source
   review, release-doctor validation, and platform signing.
2. **Embedded local shell.** `index.html`, the AbsoluteJS bootstrap, and hashed
   framework page assets execute with access to the generated provider bridge.
   They are immutable for a given store binary.
3. **Deployed AbsoluteJS origin.** The exact configured HTTPS origin executes
   route handlers, Auth, HTTP, Sync, and compatibility producers. Redirects do
   not expand this trust boundary.
4. **Page envelopes and restricted fragments.** Server responses are untrusted
   inputs even when they come from the configured origin. They are schema- and
   version-checked before rendering. HTML/HTMX fragments are sanitized before
   insertion and do not become privileged executable shell code.
5. **Operating-system services.** Keychain/Keystore, system browser, APNs/FCM,
   background schedulers, file pickers, and permission dialogs are trusted
   platform boundaries. Their denial, cancellation, or unavailability is a
   normal result, not an authorization bypass.
6. **Developer and release machines.** Native signing identities, store API
   keys, SSH credentials, and screenshots remain outside generated reports.
   Their custody and host integrity require organizational controls.

## Protected assets

- native Auth refresh credentials and secure-storage encryption keys;
- authenticated Sync rows, mutations, receipts, cursors, and account partitions;
- user-selected documents, photos, locations, notification content, and push
  installation credentials;
- application signing identities and store credentials;
- embedded executable assets and their compatibility identities;
- server secrets, database access, authorization decisions, and tenant context;
- availability of the local shell, offline cache, and mutation outbox.

Application IDs, public origins, route patterns, package versions, capability
names, and check IDs are treated as public release metadata. Certificate
fingerprints are public trust material but are still omitted from shareable
reports to avoid accidental disclosure of an unreleased signing topology.

## Threats and enforced controls

### Remote code and navigation

- Production Capacitor configuration cannot contain `server.url`, cleartext
  transport, or `allowNavigation` entries.
- The release shell is local and carries a CSP that restricts executable scripts
  to embedded assets, disables objects/base URLs/forms, and limits connections
  to the local origin and configured backend.
- Local navigation accepts only the Capacitor origin or configured production
  origin. Deep links accept only configured HTTPS hosts or the generated custom
  scheme. Credentials in deep-link URLs are rejected.
- Downloaded HTML/HTMX content loses scripts, event handlers, privileged
  elements, and cross-origin form/action targets before insertion.

Residual risk: application code can deliberately import or evaluate unsafe
content, add permissive native navigation, or weaken CSP after generation.
Release review must treat such edits as application-owned exceptions.

### Embedded asset substitution and version confusion

- Every packaged platform must contain a supported mobile manifest whose app ID,
  backend origin, runtime protocol, entry route, page/route graph, and local paths
  validate against effective config.
- Every page JavaScript and optional style asset is SHA-256 checked against the
  signed manifest. Missing, traversing, malformed, stale-runtime, and modified
  assets block release.
- Compatibility producers retain the current release plus two prior generations;
  requests carry app/runtime/page/contract identities and fail with a typed
  update result after leaving the retained window.
- Native cache fingerprints include production web assets so changed embedded
  content cannot reuse a stale installed build.

Residual risk: platform signing and store distribution establish authenticity
of the final binary. AbsoluteJS validates source projections but does not replace
signature verification or software-supply-chain controls.

### Authentication and credential exfiltration

- Web uses same-origin HTTP-only sessions. Installed apps use system-browser
  Authorization Code with PKCE, exact callback schemes, and native secure storage.
- The native HTTP provider attaches bearer credentials only to the configured
  origin, strips application-supplied credential headers, rejects redirects, and
  performs one serialized refresh/retry.
- Background Sync sends refresh credentials only to the issuer-advertised HTTPS
  token endpoint and bearer/data traffic only to the configured app origin.
- Page code receives normalized Auth state, never refresh-token material.

Residual risk: a compromised device, malicious native extension, rooted/jailbroken
OS, accessibility malware, or application logging can expose data after the
trusted runtime decrypts it. Applications must minimize retained sensitive data.

### Offline data, replay, and account separation

- Sync partitions storage by normalized principal and fails closed while signed
  out or when secure protection is unavailable unless the schema explicitly
  chooses memory-only fallback.
- Native durable payloads use authenticated AES-256-GCM envelopes with keys in
  Keychain/Keystore. Outbox operations use stable IDs and server receipts to
  prevent duplicate committed effects after lost acknowledgements.
- Generated schemas apply transactional migrations before foreground or
  background work. Quotas never evict pending mutation intent.
- Sign-out invalidates worker leases so late work cannot recreate credentials or
  write into a later account.

Residual risk: application merge policy and the business consequences of a
client-wins retry remain application decisions. Manual dead letters require UI
and operational review.

### Native capabilities and permissions

- Source import discovery selects exact, declaratively published Capacitor plugin
  versions. Missing, ranged, mismatched, or undeclared plugins fail provisioning
  or release checks.
- Android permissions, iOS usage descriptions, privacy accessed-API reasons,
  push forwarding, entitlements, and system-bar settings are derived from the
  same capability plan.
- Permission requests remain explicit application actions. Unsupported, denied,
  blocked, cancelled, and unavailable states remain distinguishable.
- Unused capability imports do not provision native plugins or permissions.

Residual risk: third-party plugins and custom Swift/Kotlin code run with native
privilege. Their implementation, transitive SDK behavior, privacy policy, and
store disclosures require human review.

### Deep links and association takeover

- Config rejects wildcard/path/port deep-link hosts and malformed schemes.
- Release checks require an Apple application prefix and all Android signing
  certificate fingerprints, then verify the native App Link/Universal Link,
  scheme, associated-domain, and Xcode entitlement projections.
- Generated association files contain exact app/signing identities. External
  verification uses HTTPS, refuses redirects, requires JSON, and compares the
  hosted document exactly.

Residual risk: DNS, hosting accounts, signing identities, and association-file
deployment are outside the native repository. Run `absolute mobile associations
--verify` against the production hosts before submission and after key rotation.

### Development artifacts and debugging

- Release doctor rejects active live-reload recovery journals, development CAs,
  cleartext flags, HMR markers, explicit Android debuggability, unconditional
  Android WebView debugging, iOS `get-task-allow`, and unconditional iOS WebView
  inspection.
- Non-launcher Android components with `android:exported="true"` produce a release
  warning and require manual authorization/permission review.
- JSON compliance output contains only public app facts, check IDs/statuses,
  aggregate totals, and manual-review categories. It omits paths, detailed error
  text, remediation, environment values, credentials, device/account IDs, and
  certificate fingerprints.

Residual risk: compiler/signing systems can inject configuration after source
inspection. Validate the final archive/AAB/APK with platform tooling and retain
store-generated signing evidence.

### Paired Remote Mac release hosts

- OpenSSH authenticates and pins the developer-owned Mac. AbsoluteJS stores no
  SSH password or private key and rejects option/shell injection in profiles.
- A protocol-versioned, content-addressed agent is SHA-256 verified before it
  prepares Capacitor or Expo, runs release doctor, and invokes Xcode.
- Source and the public embedded web bundle are synchronized atomically into an
  app-isolated workspace. Recognized environment/signing credential files,
  local `.absolutejs` state, `.git`, and dependency directories are excluded
  from the source snapshot. Applications must not place secrets in ordinary
  source files.
- An atomic, project-scoped remote lease serializes source synchronization,
  native generation, signing, and artifact retrieval. The owner heartbeats
  every 15 seconds; a two-minute expiry is recovered through an atomic rename.
  Heartbeat and release require the random owner token, preventing a delayed
  command from a crashed build from deleting its successor's lease.
- SIGINT/SIGTERM propagates to SSH/Xcode and release cleanup. Native archives and
  downloaded IPAs remain staging-only until hash-verified atomic promotion.
- Workspace cleanup matches only abandoned staging directory classes older
  than one day and retains active leases, source/cache roots, immutable
  releases, and content-addressed agents.
- Apple signing identities and provisioning profiles remain in the Mac's
  Keychain/Xcode configuration. App Store Connect and release-registry
  credentials remain on the initiating computer; only the non-secret team ID
  and allocated integer build number cross SSH.
- The returned IPA is written to a local staging file, then its byte length and
  SHA-256 are recomputed before immutable installation. Remote paths are derived
  from validated app/release identities and are never accepted from an event.

Residual risk: a paired Mac is a trusted build host and can compile malicious
native code or use a compromised signing identity. Restrict SSH access, patch
macOS/Xcode, protect its Keychain, audit custom native dependencies, and verify
store-side signing/build evidence. Artifact hashing detects transfer and stale
workspace substitution; it does not make an untrusted compiler trustworthy.

## Release-doctor contract

Run from the application root after a production bundle and native sync:

```sh
bunx absolute mobile doctor release --config absolute.config.ts
bunx absolute mobile doctor release --config absolute.config.ts --json
```

The human form contains local relative paths and remediation. The JSON form is a
redacted CI/support artifact with format version `1`. A warning does not make
`ready` false, but it is an explicit manual-review obligation. Any failed check
blocks native build and publication workflows that invoke release validation.

The audit covers these groups:

- `mobile.production-origin`, `mobile.association-identities`,
  `mobile.dependency-lock`, and `mobile.capacitor-versions`;
- per-platform development residue, packaged identity, cleartext/transport,
  HMR, bundle integrity, CSP, native debugging, and deep-link projection;
- Android exported-component review;
- generated Sync storage/schema policy; and
- exact device-provider packages, permissions, iOS usage descriptions, privacy
  manifest membership/reasons, system UI, and native push projection.

The report's `manualReview` list is intentionally never auto-passed:

- physical-device behavior and process-death/upgrade acceptance;
- App Store/Google Play privacy and data-safety questionnaires;
- the application's privacy policy;
- signing-key and store-credential custody; and
- data practices of custom native code and third-party SDKs.

## Incident and exception handling

Do not bypass a failed release check by editing copied native output. Correct the
AbsoluteJS config, dependency graph, source capability, or owned projection and
rerun bundle/sync/doctor. If an application needs an intentional exception:

1. document the threat, affected platform/version, and business requirement;
2. constrain the exception to the smallest native build configuration;
3. add a regression test proving it cannot affect other applications/builds;
4. record store/privacy implications and an owner/review date; and
5. keep the release doctor failing until AbsoluteJS has a typed, reviewable
   configuration contract for that exception.

Critical/high findings in this framework boundary block a Capacitor v1 stable
release. Findings confined to application code block that application's release
until its owner accepts or fixes them under its own security process.

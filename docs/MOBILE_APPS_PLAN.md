# AbsoluteJS Mobile Apps: Research and Implementation Plan

Status: Capacitor Android development/release, all-framework embedded bundles, universal native Auth/Sync, Expo hybrid native Auth/Sync, background Sync, automatic device provisioning, provider-neutral native push registration, signed staged Capacitor updates, and Android conformance are operational; iOS development/release automation is shipped and awaiting real macOS/physical-device acceptance

Implementation checkpoint (September 1, 2026, Expo Android/iOS release slice):
`0.20.0-beta.49` makes Expo Android a production-capable experimental provider.
The ordinary `mobile build android`, release doctor, immutable release registry,
automatic Play version-code allocation, `mobile publish android`, and generated
protected GitHub Actions pipeline now work for both providers. Expo builds use
clean CNG, pinned generated-shell dependencies, and a production-only
Prebuild/Metro/Gradle environment. The doctor verifies app config, SDK/lockfile
alignment, byte-for-byte opaque asset projection, bundle integrity, transport,
deep links, debug residue, Sync policy, and provider-specific device packages.
`0.20.0-beta.51` extends that provider-neutral release surface through paired
Remote Mac production builds while retaining the Expo iOS work introduced in
the prior beta:
clean production CNG, generated workspace/scheme discovery, signed immutable
IPA output, App Store build-number allocation, TestFlight publishing, and
protected macOS CI. Expo-on-WSL production projection remains an
engine-specific checkpoint.

Implementation checkpoint (August 31, 2026, Expo typed-data slice):
`0.20.0-beta.48` makes application-owned Expo React routes a typed renderer for
the same ordinary AbsoluteJS server route. Generated wrappers supply
`pageProps`, path/query `params`, and `reload`; developers reuse their existing
page-props type and write no fetch, token, loading, or compatibility code.
Development requests are explicitly development-only. Prepared applications
embed a minimal trusted release manifest and negotiate the full versioned page
protocol, including retained server representations for older installed apps.
Native Auth owns authenticated requests, so credentials never enter application
route code. Real macOS/physical-device acceptance remains tracked in
[IOS_MACOS_TESTING.md](./IOS_MACOS_TESTING.md).
Research snapshot: August 26, 2026

Implementation checkpoint (August 30, 2026, Expo Phase 7 development loop):
AbsoluteJS `0.20.0-beta.40` made `mobile.engine: 'expo'` select a separate,
explicitly experimental Expo SDK
57/Expo Router shell while Capacitor remains the default. AbsoluteJS generates
CNG configuration, a native diagnostic screen, static native-route wrappers,
and a WebView catch-all for all unclaimed framework routes. The existing signed
page bundle is transported through Metro as opaque assets and reconstructed
with stable relative paths. Expo Router owns deep links and native transitions;
the WebView retains web history. The original bridge format enforces a 64 KiB maximum,
bounded IDs/paths, request timeouts, current-page identity, and a method
allowlist; the first provider-neutral proof was `@absolutejs/devices` haptics.
`0.20.0-beta.41` adds an Expo development-client dependency and makes `bun dev`
own one Metro server plus configured local Android/iOS builds. Native React
routes use Metro Fast Refresh; every web route loads the live Bun origin with
an `expo-android` or `expo-ios` identity and uses the existing framework HMR,
timing logs, and redacted telemetry. `0.20.0-beta.42` projects the local HTTPS
CA without disabling transport validation. `0.20.0-beta.43` extends the
versioned Remote Mac protocol with an Expo executor: Metro remains on the
developer computer, the disposable iOS CNG shell and Xcode build run on the
paired Mac, and independent SSH tunnels/physical-device relays carry Bun and
Metro traffic. The bridge tracks live browser history so its current-route
authorization remains correct across SPA navigation. Release tooling and
physical-device acceptance remain explicit gates. See
[MOBILE_EXPO_EXPERIMENT.md](./MOBILE_EXPO_EXPERIMENT.md).

Implementation checkpoint (August 31, 2026, Expo Auth slice): AbsoluteJS
`0.20.0-beta.44` automatically provisions `@absolutejs/auth-expo@0.0.2` and
the exact compatible Auth runtime when an Expo application already uses
`@absolutejs/auth`. Expo WebBrowser owns system-browser S256 PKCE and
cold/warm callbacks; Expo SecureStore retains only renewable credentials with
device-only after-first-unlock protection. Native React routes install the same
provider-neutral Auth transport at the root layout, while embedded routes use
bridge format 2 for typed sign-in/sign-up/sign-out/status/principal events and
bounded exact-origin HTTP. Bearer injection,
refresh rotation, and the `401` retry remain in the native runtime; passwords,
access tokens, and refresh tokens cannot cross the WebView bridge. The generated
SDK 57 shell passes package install, TypeScript, CNG prebuild, and Metro export.
Expo Sync is completed in the next checkpoint below.

Implementation checkpoint (August 31, 2026, Expo Sync slice): AbsoluteJS
`0.20.0-beta.45` provisions `@absolutejs/sync@2.31.0` and
`@absolutejs/sync-expo@0.0.2`. Native React routes use the generated encrypted
Expo SQLite store directly; all ordinary framework routes use the same typed
store through bridge format 3. Native Auth chooses the principal partition and
owns one-time socket tickets, so neither value crosses into page-controlled
JavaScript. Native sockets chunk frames across the 64 KiB bridge boundary.
Expo AppState/Network recovery is authoritative and BackgroundTask performs
only bounded best-effort headless push/pull. Store, bridge, migration,
process-restart, account-isolation, package-install, TypeScript, Android/iOS
CNG, and Android Metro export gates pass; real iOS runtime and physical
background acceptance remain partner gates.

Implementation checkpoint (August 31, 2026, Expo Devices slice): AbsoluteJS
`0.20.0-beta.46` provisions `@absolutejs/devices-expo@0.0.2` from ordinary
provider-neutral imports. Camera/photos, clipboard, documents, haptics,
keyboard, location, local/push notifications, share, and system bars work in
native routes and embedded routes without application-owned native wiring.
Generated CNG owns exact SDK packages, plugins, scoped permissions, iOS usage
descriptions, and privacy manifests. The bridge chunks binary data, bounds
concurrency/size/lifetime, strips native-only values, and keeps APNs/FCM tokens
behind native Auth. Package, TypeScript, Expo compatibility, and clean Android
CNG gates pass; real iOS runtime and process-death picker recovery remain gates.

Implementation checkpoint (August 31, 2026, Expo route-pattern slice):
AbsoluteJS `0.20.0-beta.47` makes native replacement ownership practical for
data-driven applications. `mobile.routes.native` accepts named `:params` and a
terminal `*`, generates the corresponding Expo Router directories, and uses the
same deterministic matcher for WebView links and bridge navigation. Config load
rejects equivalent parameter patterns, malformed or repeated parameters, root
wildcards, and Expo/Metro reserved paths. Regeneration removes stale
AbsoluteJS-managed wrappers while preserving every application-owned module.

Implementation checkpoint (August 29, 2026): the Phase 6 release-security
baseline is implemented. `absolute mobile doctor release` now validates exact
and aligned Capacitor core/CLI/platform packages, a committed dependency lock,
HTTPS production transport, platform association identities, packaged app
identity, supported runtime/manifest/route structure, SHA-256 integrity for
every embedded page/style, generated CSP, native deep-link projection, Android
exports/debugging, iOS debugging, privacy-manifest reasons/target membership,
usage descriptions, system UI, push forwarding, Sync schema/policy, and exact
capability plugins. Human output retains local remediation; `--json` emits only
public app facts, check IDs/statuses, totals, and explicit manual-review classes.
Adversarial coverage mutates assets, dependency pins, native debugging, exports,
privacy projection, live transport, HMR, and cleartext settings. The formal
boundary and residual risks are in `MOBILE_SECURITY_THREAT_MODEL.md`.

Implementation checkpoint (August 29, 2026, generated CI slice):
`absolute mobile ci github` derives a deterministic GitHub Actions workflow from
the effective mobile config. Pull requests perform a secret-free production
bundle build with SHA-256 and capability enforcement. Protected manual jobs
import ephemeral Android/iOS signing material, build and re-audit one selected
platform, optionally create provenance attestations, retain immutable artifacts,
and compose the existing Google Play/TestFlight publishers. Jobs are serialized
per repository and never interpolate workflow inputs as shell source. Android CI
can sign an otherwise unsigned AAB through AbsoluteJS using `jarsigner` password
environment references, so ordinary applications need no CI-specific Gradle
edit. The setup and rotation contract is in [MOBILE_CI.md](./MOBILE_CI.md).

Implementation checkpoint (August 29, 2026): the planned read-only
`absolute mobile inspect` command is now implemented. Human and JSON output
inventory the effective config, project-relative native/bundle paths, runtime
package versions, source-discovered capabilities and exact plugin requirements,
native-project presence, release-doctor status IDs, and a structurally validated
embedded manifest with build/runtime, framework, route/page, Auth/Sync, entry,
asset, and capability-drift checks. Shareable JSON omits credentials,
environment values, certificate fingerprints, device/account identifiers,
absolute paths, and release-doctor detail strings. Inspection never builds,
syncs, launches, contacts the application server, or mutates the project.

Implementation checkpoint (August 29, 2026): iOS now has production
embedded-bundle conformance parity for the core installed-app lifecycle. The iOS
controller has an explicit embedded mode that never projects a development
`server.url`, includes copied production web assets in its native cache
fingerprint, and therefore reinstalls when an embedded bundle changes. The real
Simulator gate drives ordinary in-app links across React, Angular, Vue, Svelte,
HTML, HTMX, and back, executes the hashed local HTML script, terminates and
relaunches from local assets, and installs a build-number/bundle upgrade while
proving application storage survives. A bounded reporter is injected only into
the generated conformance fixture and communicates only with its loopback test
backend; it is absent from product/application bundles. `test:native:ios` now
runs both the six-case development lifecycle and four-case production bundle
suite. Linux unit/type coverage proves embedded config isolation and bundle
fingerprint invalidation; real Xcode execution remains the partner Mac gate.

Implementation checkpoint (August 28, 2026): mobile-enabled `bun dev` now
prints and serves a first-class browser target at
`/__absolute/mobile-preview`. It runs the same live multi-framework page and HMR
graph as installed development targets with a distinct `mobile-preview` HMR
identity, startup/HMR timing telemetry, and a realm-shared provider layer
installed before application modules evaluate. The control surface switches
iOS/Android platform and safe-area identity and emits Network, lifecycle,
deep-link, hardware-Back, keyboard, and permission state through
`@absolutejs/devices`. Offline mode also rejects application `fetch` and
`@absolutejs/http` requests while preserving HMR infrastructure. The endpoint
exists only in development for mobile-configured applications. Real Chromium
conformance covers boot, HTTP isolation, Network/lifecycle/permission controls,
and platform switching; unit/server conformance covers distinct HMR timing and
telemetry. This SDK-free target does not claim WebView/native rendering, native
Auth/secure storage, push, signing, store, OS scheduling, or process-death
parity; those remain simulator/physical-device gates. Production embedded-shell
and page-envelope compatibility behavior remains covered by installed-app
conformance.

Implementation checkpoint (August 27, 2026): `@absolutejs/http@0.0.1` is now
published as the application-facing connected transport. Application code uses
one `http` client across web, PWA, SSR with an explicit request-scoped provider,
and Capacitor. Requests are locked to the configured AbsoluteJS origin, require
HTTPS outside loopback development, reject application-supplied credential
headers, disable redirect forwarding, and keep private error bodies out of
automatic diagnostics. Browser requests retain same-origin HTTP-only cookies;
the generated Capacitor shell installs the existing native Auth fetch, so bearer
refresh and one retry on `401` remain inside `@absolutejs/auth` and tokens never
enter page code. A realm-stable runtime registry allows independently bundled
framework pages to see the shell provider. Unit/provider conformance and the
installed Android Auth/Sync acceptance now require a successful protected HTTP
request before Sync begins; `HTTP-01` is added to the macOS/iOS handoff.

Implementation checkpoint (August 26, 2026): the remaining Wave 1 system-UI
surface is implemented in `@absolutejs/devices@0.7.0`,
`@absolutejs/devices-capacitor@0.8.0`, and AbsoluteJS `0.20.0-beta.30`.
Application code imports `keyboard` and `systemBars` without provider branches.
Keyboard exposes visibility, CSS-pixel height, dismissal, and cleanup-safe
events through VisualViewport on web and the exact Capacitor Keyboard 8.0.5
plugin on native. System bars use Capacitor 8's bundled modern edge-to-edge API,
not the legacy Status Bar controls disabled by Android 16 enforcement. AbsoluteJS
discovers both imports, installs only Keyboard, generates the provider wiring,
and owns the required iOS view-controller status-bar setting. The example route,
unit/provider/projection coverage, and eight-step macOS/physical-device checklist
are included; physical iOS behavior remains partner-gated.

Implementation checkpoint (August 26, 2026): the provider-neutral native push
boundary is implemented across Devices, Auth, Dispatch, and the generated
Capacitor shell. Application code imports `pushNotifications` from
`@absolutejs/devices`; it can explicitly query/request permission, enable or
disable delivery, and subscribe to normalized receipt/action events, but no
public contract exposes an APNs or FCM token. The generated shell alone receives
that token and sends it to the fixed bearer-authenticated
`/auth/push` route (`/auth/mobile/push` remains an installed-client alias). Auth derives user, tenant, and authorized topics on
the trusted server. Dispatch issues an opaque installation identity, verifies
ownership during rotation/removal, fans out through provider adapters, and
retires invalid tokens. Failed sign-out cleanup cannot strand a later account:
the server returns a safe ownership conflict and the shell retries once as a
new installation. iOS entitlement/AppDelegate plumbing and Android Firebase
configuration projection are generated idempotently. Permission prompts remain
explicit; sign-in only re-enables delivery when permission was already granted.
This slice ships in AbsoluteJS `0.20.0-beta.25` with
`@absolutejs/auth@0.74.0`, `@absolutejs/dispatch@0.8.0`,
`@absolutejs/devices@0.6.0`, and `@absolutejs/devices-capacitor@0.7.1`.

Implementation checkpoint (August 26, 2026): AbsoluteJS
`0.20.0-beta.24` includes the beta 23 native evidence/Documents work and adds
the first provider-neutral Local Notifications slice. Applications import
`localNotifications` from `@absolutejs/devices@0.5.0`; AbsoluteJS discovers the
named import, provisions `@absolutejs/devices-capacitor@0.6.1` and the complete
official `@capacitor/local-notifications@8.2.1` artifact, generates adapter
wiring, and projects Android display permission without exact-alarm access.
Permission queries and scheduling never prompt implicitly. The shared contract
covers one-time best-effort schedule, pending, cancel, receipt, and tap/action
events across web, SSR, tests, and Capacitor. Repeats, exact alarms, critical
alerts, and push delivery remain separately gated. The example acceptance route,
Android/iOS report rows, and eight-step macOS/physical-device checklist ship in
the same release.

`0.20.0-beta.23` generalized the local-only native evidence workflow and added
`absolute mobile test android --report` parity with iOS. Machine-observed
emulator/launch/HMR/timing results populate matching Markdown and JSON; manual,
physical-device, Auth, Sync, signing, and store checks remain explicitly
`NOT_RUN`, and captured text is redacted.

The provider-neutral Documents slice is now published in
`@absolutejs/devices@0.4.0` and `@absolutejs/devices-capacitor@0.5.0`.
Applications use `documents.pick`, `documents.export`, and `documents.open`
without runtime branches or paths. Web and WebView selection is Blob-backed;
native export/open stage bounded content in the app cache, call official
Capacitor Share/File Viewer plugins, and erase it afterward. Named-import
discovery installs exact plugin versions and projects the Filesystem plugin's
Apple required-reason API declaration into an automatically targeted
`PrivacyInfo.xcprivacy`. The example route, unit/adapter coverage, Android
report row, and eight-step macOS/iOS partner checklist are included. Expo
remains gated on physical iOS acceptance.

Implementation checkpoint (August 20, 2026): the first React protocol seam now
includes request-scoped mobile negotiation without route edits, versioned app,
runtime, page, bundle, and contract headers, typed update/error envelopes, a
validated client activator, and generated React client-render mode. The first
automatic compatibility primitives are also implemented: deterministic,
content-addressed, secret-free release metadata; generated prop-schema
fingerprints; exact current-plus-two retention; release/page resolution; and an
Elysia dispatch hook that caches and invokes a matching archived producer while
verifying that the requested URL belongs to the identified page. Backwards
compatibility comes from these generated release artifacts, not declarations in
ordinary route/page code. A provider-neutral artifact-store contract now has an
atomic filesystem implementation and a structurally compatible
`@absolutejs/blob` adapter; carry-forward verifies and selects current plus two,
then materializes immutable producer bundles behind an atomic pointer. Production
`prepare()` automatically mounts the dispatcher when that bundle is present.
Archived execution now uses a cross-bundle async context: nested compatibility
dispatch is bypassed without a spoofable request header, and the old producer
emits the exact page contract already validated by the outer dispatcher.
Build-time route/schema extraction and archived producer compilation are now
connected for recognized React page handlers. A TypeScript build transform derives
stable component identity and a canonical prop-schema fingerprint, attaches that
private metadata to the page call and Elysia route detail, and then consumes Elysia
2's finalized `app.routes` graph so prefixes and plugin composition are
authoritative. Mobile-enabled `absolute start` and `absolute compile` hash the
actual client bundle and compiled server producer, derive app builds and
generations automatically, carry forward current plus two, and atomically
materialize the compatibility bundle already mounted by `prepare()`. Unchanged
builds reuse their generation; a typed prop or executable bundle change advances
it without application declarations. The production fixture proves a prefixed
unchanged route through the generated envelope and generation 1→2 retention. The
transform/conformance matrix still needs to expand beyond React.

The next transport checkpoint is also operational. Mobile config now owns the app
identity/name, HTTPS production origin, entry route, platforms, local web bundle,
native source directory, and deep-link allowlist. Production prepare/compile emits
an atomic Capacitor `webDir` containing only the local shell, signed client page
bundles, and a route/page manifest; it does not copy the server producer. The shell
uses a canonical origin-locked page transport, selects routes locally, client-renders
the server envelope, intercepts same-app navigation, and consumes launch/live deep
links through the official Capacitor App plugin. `absolute mobile init` generates a
reviewable `capacitor.config.ts` with local assets and editable iOS/Android source
paths, while `absolute mobile sync` delegates copying and native dependency updates
to Capacitor. Init and sync now also apply idempotent, AbsoluteJS-owned native
deep-link regions: verified HTTPS App Link filters and an optional custom scheme on
Android, plus optional URL-scheme registration, associated-domains entitlements,
and Xcode target wiring on iOS. Existing custom iOS entitlement wiring is rejected
instead of overwritten. A disposable Capacitor 8.5 probe successfully generated
real Android and iOS source projects and applied both native configurations twice
without drift. Association publication is now implemented too: production
`prepare()` serves the extensionless AASA and Android `assetlinks.json` endpoints,
and `absolute mobile associations` atomically generates an ownership-protected,
per-host `.well-known` tree for Absolute Deployments or another host. Signing
identities are normalized and release publication fails when a configured platform
is missing them. Deploying those files with real signing identities, PKCE/secure
credential storage, authenticated API/Sync transport, and real simulator/device
conformance remain next.

Revision note: the initial draft assumed an explicit list of statically exported
mobile routes. Product feedback rejected that constraint. This revision makes the
existing AbsoluteJS/Elysia route graph authoritative, discovers it automatically,
and gives the same route a web representation and a mobile representation without
requiring application route changes.

## Executive summary

AbsoluteJS should add mobile support in two deliberately separate generations:

1. **v1: Capacitor, targeting all existing AbsoluteJS page frameworks.** AbsoluteJS discovers recognized server routes, embeds their compiled UI/assets and a local mobile router in native iOS and Android projects, and asks the deployed AbsoluteJS server for the live data/result envelope of a route. The same Elysia handler computes the same props and status for web and mobile. A framework-agnostic `@absolutejs/devices` API selects web or Capacitor implementations at build time. React, Svelte, Vue, Angular, Ember, HTML, HTMX, and islands remain web-rendered, but each framework enters the stable support matrix only after conformance tests pass.
2. **v2: Expo hybrid rendering.** Expo becomes a different renderer and application shell, not a drop-in Capacitor option. Expo Router owns native navigation, selected routes use React Native UI, and the remaining AbsoluteJS routes run in WebViews/DOM surfaces. This requires an explicit navigation, state, authentication, and device-API bridge.

The essential technical boundary is that Capacitor packages built web assets; it does not embed the Bun server. AbsoluteJS currently server-renders many pages and sends framework hydration bundles to the browser. Therefore, v1 can support every page *framework* and preserve request-time route behavior, but server execution still occurs on the deployed AbsoluteJS backend. The mobile binary embeds the UI runtime, route shell, and assets; it does not embed Bun, secrets, databases, or Elysia.

The key enabling feature is a dual page protocol:

- A browser request receives the current streamed HTML response and HTTP-only cookie session.
- A mobile route request executes the same Elysia handler but normally receives a typed data/result envelope containing status, redirect/error information, framework/page identity, versioned props, head metadata, and asset IDs. The embedded page entry performs a client render. Restricted HTML/HTMX surfaces may receive sanitized markup, but never arbitrary executable server HTML in the privileged native shell.

Absolute-owned HTTP, Sync, HTMX, navigation, and auth surfaces use a mobile transport that targets the deployed server and supplies the native session. Raw origin-sensitive browser APIs are diagnosed and remain best-effort compatibility because the web platform has no single safe interception point for fetch, XHR, forms, assets, WebSocket, EventSource, workers, and navigation. Application authors continue to register recognized page routes normally.

The recommended public promise is:

> Write supported AbsoluteJS routes and framework UI once and ship them to the web, iOS, and Android. The same route handler and data logic run on your AbsoluteJS server; Absolute-owned auth, HTTP, Sync, navigation, storage, and device APIs select the appropriate implementation automatically. Doctor identifies origin-sensitive or unsupported behavior that needs an explicit migration.

Do not promise that Bun, Elysia handlers, server secrets, databases, or SSR run on the phone.

## Decisions proposed by this plan

These are recommendations, not yet final product decisions.

| Area | Recommendation |
| --- | --- |
| Default mobile engine | `capacitor` |
| v1 content model | Embedded UI/assets plus version-negotiated data/result envelopes; restricted sanitized markup only where client rendering is impossible; never a production remote `server.url` |
| Framework support | Target all current page frameworks and islands; stable support is conformance-gated and may roll out incrementally |
| Routes | Automatically discovered from the existing server route graph; no separate mobile route list |
| Dynamic data | Existing Elysia handler computes route props; later interactions use the same deployed AbsoluteJS server |
| Offline behavior | `@absolutejs/sync` is the shared local-first data layer for web, PWA, Capacitor, and later Expo; the local shell always launches and declared sync collections read/write offline |
| PWA boundary | `@absolutejs/pwa` owns installability, service-worker shell/assets, web push, and best-effort browser background wake-up; it delegates application-data reconciliation to Sync |
| Native project model | v1 defaults to generated-once, committed Capacitor projects with non-destructive structural automation; expose `managed`, `source`, and `external` ownership modes only as their contracts mature |
| Configuration source | `absolute.config.ts` owns AbsoluteJS mobile settings; generated `capacitor.config.ts` remains inspectable and supports a typed escape hatch |
| Device APIs | Provider-neutral contract plus separate web, Capacitor, and later Expo adapters |
| Permissions | Capability check first; request only from an explicit user action |
| Expo | v2 hybrid renderer, not part of the initial Capacitor abstraction |
| Per-route native UI | v2 route metadata/mapping; not a page-level build switch in v1 |
| Authentication | Same public auth API; web uses HTTP-only sessions, installed apps use system-browser Authorization Code + PKCE and native credential storage |
| Development | One `bun dev`/`absolute dev` graph serves web and mobile targets, opens the browser preview, and boots or reuses the selected native emulator when its toolchain is available |
| OTA updates | Not in v1; research separately with native-runtime compatibility and store policy controls |
| Compatibility history | AbsoluteJS owns the format and runtime; `@absolutejs/blob` supplies local/S3-compatible durable storage; `@absolutejs/deploy` orchestrates carry-forward and embeds the selected immutable bundle into each deployment |

## Goals

- Let an existing AbsoluteJS app add iOS and Android targets without changing its page framework.
- Let recognized routes, dynamic parameters, redirects, errors and loaders/props
  work without a second mobile route declaration; make application networking
  portable through Absolute-owned APIs and diagnose unsafe origin assumptions.
- Preserve one source of truth for UI, routing paths, shared types, validation, and API contracts.
- Make declared application data local-first through the same `@absolutejs/sync` API on browsers and installed apps: immediate local reads/writes, durable outbox, reconnect catch-up, and explicit conflict policy.
- Let AbsoluteJS packages ship sync packs so an installed feature brings its schema, collections, mutations, permissions, schedules, and offline behavior as one portable unit.
- Make `bun dev` build and expose the browser and configured mobile target from one watcher and dependency graph.
- Make the common workflow feel native to the AbsoluteJS CLI rather than requiring users to learn the Capacitor CLI immediately.
- Provide a stable `@absolutejs/devices` surface that behaves sensibly in browsers, Capacitor, SSR, tests, and eventually Expo.
- Keep native projects open and editable. AbsoluteJS should automate native work, not hide it.
- Produce local, CI, signed-release, deep-link, and app-store workflows.
- Make limitations visible at build time instead of shipping blank pages or runtime-only failures.
- Leave a clean architectural seam for Expo-native routes without coupling v1 to React Native.

## Non-goals for v1

- Running Bun or Elysia on iOS or Android.
- Transparently embedding request-time SSR, database access, or server secrets.
- Translating React/Vue/Svelte/Angular/Ember/HTML into native controls.
- Matching every Capacitor or browser API behind a lowest-common-denominator interface.
- Generating arbitrary Swift/Kotlin code from application TypeScript.
- Hiding the existence of code signing, privacy/data declarations, store metadata,
  platform accounts, physical-device testing, or native debugging. Supported
  capabilities should not require application authors to edit native files.
- Expo, React Native, Expo Router, EAS Build, or EAS Update in the first release.
- A production mode that simply opens a hosted website inside the app.
- Automatically making arbitrary imperative `fetch`, form submissions, uploads, third-party calls, or opaque server-only route work safe offline. Declared Sync collections/mutations get the local-first guarantee; other network operations must declare a policy or surface an offline result.
- Guaranteed execution at a requested time while the app is backgrounded or terminated. Browser and mobile operating systems schedule background work opportunistically; foreground, resume, and connectivity triggers remain the correctness path.
- OTA updates until compatibility, signing, rollback, and review-policy semantics are designed.

## What exists today

Repository inspection shows:

- `src/core/build.ts` scans and builds all frameworks, producing Bun server modules, browser hydration bundles, CSS, and a manifest.
- Framework page handlers perform SSR and serialize initial props into HTML before booting a browser bundle.
- Routes are registered explicitly in the user's Elysia server entry. A source page file is not, by itself, the canonical route.
- `src/core/prerender.ts` can fetch configured routes from a temporary server and save completed HTML, but its output is a server-side `_prerendered` cache, not a standalone deployable site.
- SPA-route analyzers already exist for React, Vue, Svelte, and Angular, but they are mainly used for sitemap and server route validation.
- HTML and HTMX pages are server-served files; HTMX mutations still expect server endpoints.
- The CLI already has lazy command modules and build/start/prepare workflows suitable for adding a `mobile` command family.
- `BaseBuildConfig` in `types/build.ts`, config reserved-key detection, config UI schema generation, `absolute doctor`, release packaging, and CLI help all need to recognize a new mobile config.
- The wider `~/abs` workspace commonly publishes small `@absolutejs/*` packages and adapter packages, which fits a separate device-contract package.

## Final `~/abs` ecosystem audit

The workspace contains more than two hundred package manifests, including examples,
adapters, and internal applications. The important result is not the raw count: the
mobile initiative is **not** starting from an empty platform. AbsoluteJS already
owns most server-side reliability, identity, realtime, push, storage, and
observability primitives. It has almost none of the installed-app client adapters
or native configuration metadata. The right program is to connect and extend the
existing substrate, not reproduce it under a new mobile namespace.

No inspected package currently depends on Capacitor, Expo, or React Native. Mobile
support is therefore greenfield at the runtime-adapter and native-project layers.
That is useful: the public contracts can be provider-neutral from the beginning,
and Capacitor dependencies do not need to leak into every AbsoluteJS app.

### Compatibility artifact package ownership

The implementation audit found three similarly named but distinct concerns:

- AbsoluteJS core owns mobile release metadata, prop-schema fingerprints,
  compatibility selection, producer loading, and the server dispatcher. These are
  framework/runtime contracts and must work even when an application does not use
  the official deployment package.
- `@absolutejs/blob` already owns provider-neutral bounded object storage with
  filesystem and S3-compatible adapters. The mobile store adapter deliberately
  accepts its structural `put/get/list/delete` surface, so CI can use S3, R2, B2,
  MinIO, or the local adapter without AbsoluteJS importing a cloud SDK.
- `@absolutejs/deploy` already owns immutable release archives, SHA-256 transfer
  verification, atomic host release swaps, rollback, history, and pruning. Its
  mobile integration should be a pipeline step: publish the newly compiled
  producer, fetch current plus two from the configured Blob store, materialize the
  content-addressed compatibility bundle into the server build, then deploy the
  whole release normally. Rollback therefore restores the exact compatibility
  pointer deployed with that server release.

`@absolutejs/artifacts` is intentionally not used: it models user/AI-created
product content, revisions, publication, and ownership, not executable deployment
artifacts. A new package is not justified yet. If compatibility history later has
multiple non-AbsoluteJS consumers, the store/orchestration contract can be
extracted into a narrowly named release-registry package without changing the
wire format.

### Capability inventory and disposition

| Existing area | What is already reusable | Mobile work still required | Decision |
| --- | --- | --- | --- |
| `absolute` core/build/CLI | Multi-framework server and browser builds, hydration assets, config schema, doctor, lazy commands, prerender and route analysis | Canonical runtime route capture, page-result/envelope protocol, mobile artifact graph, dev orchestration, native commands | Extend core; do not create a parallel framework CLI |
| `@absolutejs/manifest` | Contract v2 describes identity, settings, requirements, adapters, recipes, product surfaces, lifecycle commands and guarded tools | Native targets, capability declarations, permissions, entitlements, privacy use, native dependencies, minimum OS/SDK, config transforms and provider support | Add a versioned native projection before packages can claim zero-native-code setup |
| `@absolutejs/auth` | Mature server OIDC: public clients, mandatory PKCE, single-use codes, rotating refresh tokens, DPoP/nonce support, discovery, registration, device flow, PAR/JAR/FAPI and logout | Installed-app client, system-browser coordinator, app/universal-link callback, secure credential/key adapter, lifecycle refresh and generated public-client registration | Reuse the server; add mobile client/adapters, not another auth server |
| `@absolutejs/sync` | Live collections, optimistic mutations, reconnect/cursors, localStorage and IndexedDB contracts, multiplexed frames, permissions, CRDTs, framework bindings and first-party packs | Transactional native persistence, durable operation IDs/receipts, restart-safe optimistic descriptors, principal partitions, conflict policies, headless push/pull and lifecycle adapters | Make this the single offline/local-first product; do not add `offline` |
| Sync packs and CRDT/cluster adapters | Comments, counters, digest, favorites, mentions, notifications, presence and triage; Yjs, Automerge, Loro, Postgres and Redis adapters | Mobile policy metadata, migrations, deterministic local reducers, conflict UX, sensitive-field classification and adapter conformance | Packs are the unit that makes features portable and offline-aware |
| `@absolutejs/reliability` | Atomic transactions/inbox and scoped, payload-fingerprinted idempotent operations with fencing and indeterminate outcomes | A durable Sync operation-receipt integration and retention policy | Reuse its semantics; do not invent a second idempotency model |
| `@absolutejs/execution` | Transactional outbox, crash-safe external effects, provider idempotency, reconciliation, compensation and indeterminate quarantine | A handoff contract from accepted Sync mutations to server effects | Required for purchases, sends and other side effects; Sync must not replay them directly |
| `@absolutejs/queue` | Durable typed jobs, retries, leases and dead letters | Server jobs triggered after durable Sync acceptance; mobile exposes status only | Reuse server-side; never ship the queue engine into the app |
| `@absolutejs/dispatch` plus APNs/FCM adapters | Provider-neutral email/messaging/push and production device registration/fanout lifecycle | Client permission/token registration, installation identity, token refresh/removal and notification/deep-link routing | Keep server push in Dispatch; add a device-side notifications adapter |
| `@absolutejs/pwa` | Web manifest, service-worker shell/assets, web push and browser subscription glue | Wake the same Sync `pull`/`flush` paths and report constrained browser background behavior | PWA owns the web install shell, not offline data semantics |
| `@absolutejs/blob` | Bounded server streaming, local/S3-compatible stores and presigned object flow | Resumable mobile transfers, process-death recovery, file/camera sources, connectivity policy and upload status | Extend the client transfer layer; native files do not replace BlobStore |
| `@absolutejs/ai` and `@absolutejs/rag` | Typed clients/streaming and React, Vue, Svelte and Angular integrations | Audit fetch/stream support in WebView and React Native; add transport adapters where SSE/streaming differs | Server engines remain unchanged; certify client subpaths per runtime |
| `@absolutejs/voice` and `@absolutejs/media` | Provider-neutral realtime/audio/session primitives and framework clients | Microphone/audio-session permissions, interruption handling, background policy, native codecs/routes and Expo/Capacitor media adapters | Web APIs may cover v1 foreground use; advanced native media needs dedicated adapters |
| `@absolutejs/commerce` and related product packages | Provider-neutral carts/orders/payments/fulfillment and browser clients | Mark offline-safe versus online-only mutations; native wallet/payment surfaces; effect handoff and receipt recovery | Never queue charges blindly; packs declare safety and execution class |
| Beacon/errors/replay/observability | Browser errors, breadcrumbs, privacy-masked DOM replay, server ingestion and correlation | App/build/runtime metadata, native crash breadcrumbs, offline delivery and Expo-native instrumentation | Browser capture works in Capacitor; DOM replay does not cover native Expo UI |
| Analytics/attribution | Typed privacy-aware server analytics and resilient browser attribution | Install/referrer/deep-link attribution, ATT/consent, app lifecycle/session semantics and offline event transport | Add mobile adapters only after consent/data declarations are first-class |
| Audit/compliance/policy/rate-limit | Server governance and enforcement primitives | Native capability/data-use evidence, permission audit events and release-policy checks | Feed generated capability facts into these packages rather than duplicating policy |
| `@absolutejs/secrets` | Host-side secret broker for Bun runtimes | Nothing on-device; installed apps need credentials/keys, not deploy secrets | Explicitly prohibit use in mobile bundles |
| `@absolutejs/scoped-state` | User-scoped Elysia/server state | No durable client database, outbox or conflict model | Do not position it as offline storage |
| CRM/vendor sync | Server-side bidirectional vendor mirrors and token/sync stores | Optional projection of mirrored resources into authorized Sync collections | It is not a device sync engine |
| Tour/hotkeys/replay/PWA DOM surfaces | Browser-specific behavior that continues inside Capacitor's WebView | Native Expo alternatives or explicit unsupported status | Capability matrix must prevent accidental claims of Expo-native compatibility |

### Existing client compatibility classes

Every package with browser-facing code must be classified and continuously tested
instead of being assumed universal because it is TypeScript:

1. **WebView-compatible:** DOM/browser code expected to work in normal browsers and
   Capacitor, subject to origin, lifecycle and storage tests. Most current framework
   bindings start here.
2. **Transport-compatible:** UI-agnostic clients that can work in browser, WebView,
   and React Native after fetch, WebSocket, stream, crypto and storage injection.
   Sync, AI, RAG, auth and commerce should move toward this class.
3. **DOM-only:** service workers, DOM replay, hotkeys, browser tours, and other code
   that has no truthful Expo-native behavior. A native screen may use a separate
   adapter, but the framework must not silently polyfill these as working.
4. **Server-only:** databases, secrets, queues, provider credentials, webhook
   processing, effect execution and privileged policies. Build analysis must make
   these impossible to include in a mobile artifact.

Publish a generated compatibility matrix for `web`, `pwa`, `capacitor-webview`,
`expo-webview`, and `expo-native`. Package manifests provide claims; conformance
tests prove them. `absolute mobile doctor` reports unsupported imports with the
owning package and route rather than allowing Metro or a device runtime to fail
later.

### Package architecture to add

Package boundaries should isolate heavy native dependencies and keep the application
API stable:

| Package or subpath | Responsibility | Priority |
| --- | --- | --- |
| `@absolutejs/mobile` | Provider-neutral mobile config/runtime types, route/page protocol, artifact and capability graph, shell contracts and conformance kit | v1 foundation |
| `@absolutejs/mobile-capacitor` | Capacitor shell/provider, project lifecycle, config generation, structural native edits, live reload, build/open/run orchestration | v1 foundation |
| `@absolutejs/devices` | App-facing capability contracts, SSR/test behavior and web standards adapters; no Capacitor dependency in the base package | v1 foundation |
| `@absolutejs/devices-capacitor` | Small feature adapters and native plugin registration for installed Capacitor apps | v1 by capability wave |
| `@absolutejs/http` | Provider-neutral application request client with canonical backend URLs, auth injection, retry/stream semantics and browser/installed-app transports | v1 foundation |
| `@absolutejs/auth/mobile` | Provider-neutral installed-app OAuth session/client contract within the existing auth package | v1 foundation |
| `@absolutejs/auth-capacitor` | Capacitor system-browser, redirect, credential/key and lifecycle implementation | v1 foundation |
| `@absolutejs/sync-capacitor` | SQLite-backed transactional cache/outbox, lifecycle/connectivity triggers and optional headless runner | v1 local-first phase |
| `@absolutejs/mobile-expo` | Expo Router shell, route generator, WebView bridge and CNG config plugin | v2 experimental |
| `@absolutejs/devices-expo`, `@absolutejs/auth-expo`, `@absolutejs/sync-expo` | Shipped Expo-native implementations of device, Auth, and Sync contracts | v2 experimental |
| `@absolutejs/absolute/mobile/ui` | Shipped framework-neutral semantic-HTML app-shell, navigation-stack, tab-bar, sheet, back, and mobile-link primitives for web-rendered routes | Native Expo replacement screens remain real React Native UI; do not hide that renderer boundary behind fake universal components |

Feature adapters may be separate packages when they pull large native SDKs or add
sensitive permissions—for example maps, biometrics, payments, health or advanced
media. Tiny official adapters can be subpath exports from the provider package as
long as package installation does not cause undeclared native code or permissions
to enter the binary. Capacitor itself recommends small plugins for this reason.

Do not create these packages:

- `@absolutejs/offline`: it would split storage, mutation, conflict and replay
  semantics away from Sync.
- A second server push package: Dispatch already owns APNs/FCM registration and
  delivery lifecycle.
- A mobile secrets package based on `@absolutejs/secrets`: host secrets and device
  credentials have different trust boundaries.
- One giant package that installs every Capacitor or Expo module: it bloats binaries,
  declares unused permissions and makes store disclosures inaccurate.

Secure credential storage can begin as a narrow injected contract owned by mobile
Auth and shared with installation identity/Sync encryption. Promote it to a small
provider-neutral credentials package only when at least two independent public
consumers require the same lifecycle, access-control and migration semantics. That
avoids prematurely confusing preferences, encrypted databases, cryptographic keys,
and OAuth refresh credentials under one vague `storage` API.

### Native capability graph: how applications avoid native code

`@absolutejs/manifest` contract v2 can describe adapters and wiring recipes, but
its current client-framework union and product projections do not describe a native
target. It cannot yet express iOS entitlements/usage descriptions/privacy manifests,
Android permissions/features/intent filters, native dependencies, background modes,
URL schemes, minimum platform versions or provider-specific configuration. That is
the missing control plane for no-native-code DX.

Add an additive, versioned mobile projection (or contract v3 if compatibility
requires it) with declarations conceptually like:

```ts
type MobileCapabilityContribution = {
  capability: string;                 // e.g. camera.capture or notifications.push
  providers: Array<{
    engine: 'web' | 'capacitor' | 'expo';
    package: string;
    implementation: string;
  }>;
  native?: {
    ios?: {
      minimumVersion?: string;
      usageDescriptions?: string[];
      entitlements?: string[];
      privacyReasons?: string[];
      backgroundModes?: string[];
      dependencies?: string[];
    };
    android?: {
      minimumSdk?: number;
      permissions?: string[];
      features?: string[];
      intentFilters?: string[];
      dependencies?: string[];
    };
  };
  dataUse?: string[];
};
```

The final schema should use typed structures rather than free-form strings. Raw
regex/string edits are an escape hatch because they are hard to compose and are
not reliably idempotent. Expo itself warns that layered dangerous modifiers can
produce unexpected results and recommends clean regeneration; Capacitor points to
typed structural project tooling for automation.

The generated flow is:

```text
application config + installed @absolutejs/* manifests + route imports
                              |
                              v
              resolve capability/provider graph
        (target support, versions, conflicts, optional features)
                              |
                              v
             explainable native configuration plan
       permissions + reasons + privacy + links + dependencies
                 + generated runtime adapter registry
                              |
             +----------------+----------------+
             |                                 |
             v                                 v
   Capacitor committed projects          Expo CNG app config
   structural owned-region edits         generated config plugins
             |                                 |
             +----------------+----------------+
                              v
         doctor diff + consent/privacy/store-release report
```

Applications should normally write only AbsoluteJS TypeScript and configuration.
Installing a package and enabling a capability supplies its maintained native
adapter and configuration intent. The generator must be deterministic, record
which package owns each change, detect conflicts, support a dry run, and make
removal symmetric. `doctor --explain camera.capture` should say which import or
config enabled it, what each platform will change, which user-facing reason text
is missing, and which store disclosures are implicated.

This is a deliberately bounded meaning of “no native layer”: application teams do
not edit Swift, Kotlin, Plists, manifests or Gradle for supported capabilities.
AbsoluteJS package maintainers may implement and test native plugins behind those
capabilities. An unsupported native SDK requires a new adapter package or an
explicit advanced escape hatch; the framework cannot safely synthesize arbitrary
native integrations from web code.

## Adversarial DX findings and corrected product boundary

An independent adversarial review tested the plan against beginner, advanced-native,
multi-framework, CI/release, offline-author and package-maintainer personas. It
found six launch-level risks that the implementation plan must treat as kill gates,
not polish:

| Risk | Why the earlier shape fails | Required correction |
| --- | --- | --- |
| Installed bundle/server drift | A months-old binary cannot safely hydrate markup produced by newly deployed component code, CSS and prop schemas | Send app build, protocol version, page-bundle hash and supported schema range; automatically retain the current plus two generated server compatibility artifacts; serve the matching data producer or typed `upgrade-required` |
| Transparent web networking | Fetch, XHR, forms, assets, HTMX, WebSocket, EventSource and workers do not share one interception point; WebSocket cannot set an arbitrary bearer header | Guarantee Absolute-owned `@absolutejs/http`, Auth, Sync and HTMX integrations; lint/doctor raw origin-sensitive code; use a protocol auth frame or short-lived single-use ticket for Sync sockets |
| Privileged remote HTML | Injected server HTML can contain scripts, handlers, base/meta redirects or hostile forms inside a document that can call native plugins | Prefer data-only envelopes and embedded client rendering; restrict/sanitize HTML and HTMX; never execute downloaded scripts; capability bridge is method-allowlisted and gesture-aware |
| Route/page identity | Current source scanning cannot prove computed/plugin-prefixed/conditional route-to-page mappings | Define automatic support around instrumented Absolute page finalization, bundle reachable page identities independently, and fail release builds for unclassified opaque responses |
| Offline durability | Current Sync persistence is not transactional across cache/outbox, restored mutations lose optimism, IDs restart, and delivery is at-least-once | Treat local-first as a Sync v3 protocol/storage generation on a parallel release track, with crash-point and account-isolation tests |
| Cross-framework lifetime | Replacing portions of one document leaks global listeners, styles, routers, timers and singleton runtime state | Start with a hard document/runtime reset between page roots; optimize proven same-framework transitions later |

The public compatibility tiers should be named and shown by `absolute mobile
explain <route>`:

1. **Universal page:** recognized Absolute page handler, unchanged route declaration,
   embedded compatible page code and versioned data envelope.
2. **Universal network:** traffic through Absolute HTTP/Auth/Sync APIs and the
   maintained HTMX extension.
3. **Trusted HTML/HTMX:** first-class unchanged AbsoluteJS routes with signed,
   embedded documents and local application scripts; AbsoluteJS sends HTMX
   requests to the configured backend and sanitizes network fragments before a
   swap. Arbitrary downloaded scripts never execute.
4. **Web-only:** opaque responses or browser behavior for which safe mobile behavior
   cannot be proven.
5. **Native replacement:** separately authored Expo React Native UI that reuses
   route identity, loaders/data contracts, types, auth, Sync and package services,
   but not arbitrary DOM UI.

This resolves a real three-way constraint: the framework can preserve unchanged
server-page code, fully embed assets, or tolerate arbitrary existing browser
behavior, but it cannot guarantee all three simultaneously. The unchanged-code
promise applies to recognized routes and supported framework UI. Origin-sensitive
networking, executable HTML, offline mutation meaning and native-rendered Expo UI
have explicit AbsoluteJS contracts or migration diagnostics.

The initial stable release should therefore exclude Expo execution, disposable
Capacitor projects, OTA, background execution guarantees, automatic arbitrary web
API rewriting, arbitrary executable HTML envelopes, and one-shot delivery of every
device capability. It should include Capacitor committed projects, deterministic
bundle/sync/run commands, release doctor, canonical URLs, lifecycle/deep links,
mobile Auth and Sync socket authentication, secure credentials, a small first
device wave, hard-reset navigation, and only the framework matrix that has passed
the release conformance suite. The roadmap still targets every current page
framework before calling the all-framework generation complete.

## External research findings

### Capacitor

Capacitor v8 is designed to be added to an existing web app. Its requirements are a package, a web-assets directory, and an `index.html` with a `<head>`. `cap sync` copies that directory into the native projects and updates native dependencies ([installation documentation](https://capacitorjs.com/docs/getting-started)). This is a strong fit for all AbsoluteJS browser frameworks.

The normal Capacitor loop is build web assets, sync, run/open a native project, and finally build a native binary ([workflow documentation](https://capacitorjs.com/docs/basics/workflow)). AbsoluteJS can orchestrate this without replacing it.

Capacitor's `server.url`, cleartext traffic, and additional in-WebView navigation are explicitly intended for live reload and not production ([configuration reference](https://capacitorjs.com/docs/config)). Therefore, a hosted-site WebView should not be the AbsoluteJS production default.

Live reload requires a reachable development server, generally bound to the LAN, and temporary Capacitor server configuration ([live reload guide](https://capacitorjs.com/docs/guides/live-reload)). AbsoluteJS should generate ephemeral dev configuration and ensure it is never committed.

Capacitor exposes platform and plugin-availability checks, which are useful adapter internals but should not leak into application code ([JavaScript utilities](https://capacitorjs.com/docs/basics/utilities)). It also recommends small plugins to avoid unused native code, app bloat, and permission declarations ([plugin guidance](https://capacitorjs.com/docs/plugins/creating-plugins)). This argues against one adapter that installs every native plugin.

The App plugin covers lifecycle, deep links, Android back handling, and restoration of calls interrupted when Android destroys an activity ([App plugin](https://capacitorjs.com/docs/apis/app)). Those are shell-level responsibilities and need first-class AbsoluteJS integration, not only optional utility wrappers.

### Expo

Expo Router is a React Native and web router with native navigation and platform-specific route modules ([Expo Router introduction](https://docs.expo.dev/router/introduction/), [platform-specific routes](https://docs.expo.dev/router/advanced/platform-specific-modules/)). Selecting Expo changes the UI runtime, bundler, routing owner, and native project lifecycle.

Expo DOM components run React DOM in WebViews and enable incremental web-to-native migration, but they are React/Metro features. They are SPA-only, do not support SSR/SSG in the embedded component, cross the native/web boundary through asynchronous JSON, do not share global state across JavaScript engines, and cannot be native layout routes ([DOM components](https://docs.expo.dev/guides/dom-components/)). They cannot directly consume arbitrary compiled Vue, Svelte, Angular, Ember, or static AbsoluteJS pages.

The current DOM-component bridge accepts serializable props and asynchronous
top-level native actions; updates cross an asynchronous bridge and can re-render
the component tree. Several synchronous Expo Router state APIs must be read in the
native host and marshalled as props. This validates the plan's versioned bridge,
but rules out pretending native and web surfaces share one JavaScript heap or
router state.

For non-React AbsoluteJS pages, an Expo shell would need WebView hosts that use the AbsoluteJS page-envelope protocol and embedded web assets. Native routes and web routes would then require an explicit bridge.

Expo's Continuous Native Generation can regenerate native projects from configuration, while config plugins apply native changes predictably ([CNG](https://docs.expo.dev/workflow/continuous-native-generation/), [config plugins](https://docs.expo.dev/config-plugins/introduction/)). That project-ownership model differs from Capacitor's long-lived native projects and belongs in a separate adapter.

`expo prebuild --clean` deletes and recreates native directories; Expo recommends
config plugins instead of manual edits and notes that non-idempotent dangerous
modifiers can compose unpredictably. CNG also aligns the project to an Expo SDK's
expected React and React Native versions and can modify dependencies and scripts.
AbsoluteJS must pin and test that toolchain, generate structural/idempotent plugins,
and show the prebuild diff rather than treating CNG as side-effect free.

Expo already provides useful provider implementations: AuthSession supplies a
universal system-browser redirect flow; SecureStore uses native protected storage
but biometric changes can invalidate protected keys and Android backups must omit
undecryptable entries; Expo SQLite supports durable databases and optional
SQLCipher outside Expo Go. These are adapters behind Absolute Auth/Sync contracts,
not APIs application code should call directly ([AuthSession](https://docs.expo.dev/versions/latest/sdk/auth-session/), [SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/), [SQLite](https://docs.expo.dev/versions/latest/sdk/sqlite/)).

Expo background tasks remain opportunistic: Android's minimum interval is fifteen
minutes, while iOS chooses timing from battery, network and usage conditions and
may interrupt work. This matches Capacitor's limitation and confirms that foreground,
resume and connectivity-triggered Sync are correctness paths; background work only
reduces staleness ([BackgroundTask](https://docs.expo.dev/versions/latest/sdk/background-task/), [local-first guide](https://docs.expo.dev/guides/local-first/)).

Expo brownfield support exists, but direct integration into existing native apps is currently described as alpha; an isolated library approach also exists ([brownfield overview](https://docs.expo.dev/brownfield/overview/)). Retrofitting Expo into a Capacitor app to gain occasional native screens would therefore be a high-risk v2 path. A clean Expo shell with WebViews is more supportable.

EAS Update applies only non-native changes and uses runtime versions to keep updates compatible with installed native code ([EAS Update](https://docs.expo.dev/eas-update/introduction/), [runtime versions](https://docs.expo.dev/eas-update/runtime-versions/)). Any future AbsoluteJS OTA layer needs the same compatibility invariant.

### Store and product constraints

Apple guideline 4.2 says an app must offer functionality, content, and UI beyond a repackaged website ([App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)). Google Play likewise requires meaningful, stable mobile functionality and separately rejects unauthorized or affiliate-spam WebViews ([functionality policy](https://support.google.com/googleplay/android-developer/answer/9898783?hl=en), [developer policy](https://support.google.com/googleplay/android-developer/answer/17190352?hl=en&rd=1)).

AbsoluteJS should include a release readiness check, but cannot guarantee store approval. Templates should encourage mobile-appropriate navigation, offline/error states, native capabilities, responsive layouts, and complete review credentials instead of implying that packaging alone makes a website an acceptable app.

## Target architecture

```text
AUTHOR WRITES ONCE

server.ts
  .get('/account/:id', ({ params, auth }) =>
    handleReactPageRequest({ Page: Account, props: loadAccount(params, auth) }))
                                  |
                     one discovered route graph
                                  |
          +-----------------------+------------------------+
          |                                                |
 WEB REQUEST                                      CAPACITOR APP NAVIGATION
 GET /account/42                                  navigate('/account/42')
 Cookie: user_session_id                          local shell changes URL
          |                                                |
          |                                      GET https://api.example.com/account/42
          |                                      Accept: application/vnd.absolute.page+json
          |                                      Authorization: DPoP/Bearer <access token>
          |                                                |
          +-----------------------+------------------------+
                                  |
                   SAME ELYSIA ROUTE HANDLER RUNS
                   SAME params/auth/data/props run
                                  |
          +-----------------------+------------------------+
          |                                                |
 WEB PAGE REPRESENTATION                         MOBILE PAGE REPRESENTATION
 streamed full HTML                              typed page envelope
 head + SSR markup                               status/redirect/error
 serialized props                                safe head data + versioned props
 hydration modules                               framework/page/bundle hash
          |                                                |
browser hydrates                                compatible embedded bundle
                                                  performs client render
          |                                                |
          +-----------------------+------------------------+
                                  |
                          SAME COMPONENT CODE
                                  |
        +-------------------------+---------------------------+
        |                         |                           |
 @absolutejs/http/Sync      @absolutejs/auth          @absolutejs/devices
        |                         |                           |
 web: same origin          web: cookie session        web: standards APIs
 mobile: backend origin    mobile: PKCE + tokens      mobile: native plugins
 and native auth proof     secure native storage      with web fallbacks
```

This is a connected universal application model, not a static-site exporter and
not a production WebView pointed at a remote website. The installed app owns its
local shell, URL, assets, navigation integration, device APIs, secure storage,
and lifecycle. Bun remains the server runtime for dynamic page data.

The major new seams are:

1. A **canonical runtime route manifest** captured from the configured Elysia
   application. The author does not repeat routes in mobile config.
2. A **dual page response protocol** that lets the existing page handlers emit
   streamed browser HTML or a versioned mobile page envelope after executing the
   same route logic.
3. A **local mobile router/renderer** that loads a compatible embedded framework
   page bundle, client-renders versioned data, handles redirects/errors, and starts
   with hard document/runtime resets between page roots.
4. A **canonical Absolute request transport** used by `@absolutejs/http`, Auth,
   Sync and the maintained HTMX extension. Doctor identifies raw relative/origin-
   sensitive web APIs that cannot be transparently secured.
5. An **auth client/session contract** whose browser and installed-app transports
   differ while application-facing methods remain stable.
6. A **device contract and adapter system** selected by build target, not by
   runtime imports scattered through user code.

### Route and page envelope protocol

The server must recognize a versioned `Accept` media type rather than a mutable
query parameter. A conceptual response is:

```ts
type AbsoluteMobilePageEnvelope = {
  protocol: 1;
  compatibility: {
    minimumRuntime: string;
    maximumRuntime: string;
    propsSchema: string;
  };
  route: {
    id: string;
    pattern: string;
    pathname: string;
    params: Record<string, string>;
  };
  response:
    | {
        kind: 'page';
        status: number;
        framework: 'react' | 'svelte' | 'vue' | 'angular' | 'ember' | 'html' | 'htmx';
        pageId: string;
        bundleHash: string;
        props: unknown;
        head: AbsoluteSafeHeadData;
        assets: string[];
      }
    | {
        kind: 'restricted-markup';
        status: number;
        pageId: string;
        sanitizedHtml: string;
        head: AbsoluteSafeHeadData;
      }
    | { kind: 'redirect'; status: number; location: string }
    | { kind: 'error'; status: number; errorPage?: AbsolutePageResult }
    | { kind: 'upgrade-required'; minimumAppBuild: string; message?: string };
  cache: {
    etag?: string;
    maxAge?: number;
    staleWhileRevalidate?: number;
    private: boolean;
  };
};
```

Every request sends app build, runtime/protocol range, target platform and the
embedded page bundle hash. The server returns data compatible with that installed
bundle or `upgrade-required`; it never sends newer markup to older executable page
code and hopes hydration succeeds. The server must retain a declared compatibility
window—initially evaluate current plus two prior mobile runtime contracts—and make
expired builds observable before support is removed.

Compatibility is an AbsoluteJS release responsibility, not a per-page authoring
requirement. Each signed mobile release should produce two linked artifacts:

1. the embedded client page/runtime manifest shipped in the application; and
2. a secret-free server compatibility bundle containing its instrumented route
   graph, page identities, generated prop schemas/fingerprints and data-result
   producers.

Server deployment automatically retains the current bundle plus the two previous
mobile compatibility bundles. A mobile request is dispatched to the matching
retained producer before the current page handler runs, so the old producer computes
the props its old embedded component expects. Current credentials, Auth principals,
service adapters and databases are injected at runtime; secrets are never archived
inside the compatibility artifact.

The TypeScript/build graph can automatically detect unchanged and additive prop
schemas and allow the current producer where proven compatible. A breaking removal,
rename or type change selects the archived producer instead; AbsoluteJS does not try
to guess semantic field mappings. This is equivalent to retaining old API versions,
but generated as part of `absolute mobile release` rather than hand-maintained in
routes.

Database and external-service evolution still has a real boundary: an old compiled
producer cannot read a column that was immediately deleted or call a provider API
that was removed. Release doctor must enforce an expand/contract migration window
covering all supported mobile generations, verify that retained bundles load, and
block retirement while supported app builds still depend on them. A manual adapter
is an advanced recovery escape hatch only when an application intentionally breaks
that rule; it is not normal mobile DX.

The exact wire shape requires a prototype, but it must preserve HTTP status,
headers that affect caching/locale, redirects, not-found/error conventions, safe
head data, page identity, schema identity and serialized props. It must not
serialize arbitrary response headers, secrets, component functions, server
closures, scripts, event handlers, `<base>`, meta refresh, or unvalidated URLs.

Page handlers currently return `Response` directly. Internally, they should first
create a framework-neutral `AbsolutePageResult`; a finalizer then produces browser
HTML or the mobile envelope based on request context. This avoids rendering HTML
and parsing it back into a data structure and gives every framework one conformance
target.

For compatibility, the AbsoluteJS Elysia plugin should hold the current request
and requested representation in scoped/async context. Existing calls that do not
pass `request` into `handleReactPageRequest` or other handlers still work. Explicit
request input remains available to applications and routers.

### Automatic route discovery

The built Elysia application is the source of route patterns, while instrumented
Absolute page finalization is the authoritative source of page identity. During
prepare/build/dev, AbsoluteJS should capture the finalized route table after plugins
are mounted, bundle reachable page identities independently, and combine this with
existing handler-call scans for diagnostics and static optimization. Perfect static
route-to-page inference is not a prerequisite for computed or conditional handlers.

- Static, parameterized, wildcard, plugin-mounted, grouped, and workspace-service
  routes retain their normal paths.
- GET/HEAD page routes enter the mobile route manifest automatically.
- API routes remain network endpoints and are not treated as pages.
- Redirects, 404s, error conventions, and SPA child routes keep their semantics.
- A route that finalizes through an instrumented Absolute page handler supplies its
  stable page ID with the result, even when it was mounted through a prefix, group,
  wrapper or conditional branch.
- Arbitrary HTML/`Response` output does not silently become privileged executable
  mobile content. It must be classified as restricted sanitized markup, intentionally
  web-only, or migrated to an Absolute page result.
- A release build fails for a reachable opaque response without an explicit
  classification. Development produces an actionable `mobile explain` diagnostic,
  never a blank page.

No `mobile.routes` list is required. Optional include/exclude policy may exist for
security, binary size, or intentional web-only routes, but the default is that the
normal app route graph is mobile.

#### Elysia 2 AOT and introspection integration

The Elysia 2 beta provides a better foundation than an Absolute-specific route
discovery subprocess, but it does not make route discovery a pure static-AST
operation. Its official AOT build plugin imports and dry-runs the exported Elysia
application, waits for asynchronous plugins, compiles the app, and emits captured
handler and validator code. The published implementation exposes the finalized
`app.routes` graph after prefixes, groups and `.use()` plugin composition. Rebuilds
are evaluated in a disposable worker; the first capture still evaluates top-level
application code. `Manifest.isCapturing()` (the public alias for Elysia's capture
state) lets packages suppress long-running build-time resources.

Use these seams as follows:

1. Compose the AbsoluteJS Bun build plugin with `elysia/plugin/aot/bun`; do not
   fork Elysia's handler compiler or invent a second application-import protocol.
2. Require the configured server entry to export its Elysia app, which the Elysia
   AOT plugin already requires. Absolute-generated templates and doctor should
   provide or verify this automatically.
3. Read the fully composed `app.routes` table as the authoritative method/path/
   handler/hooks graph after `app.modules` settles. This resolves conditional
   registrations, computed prefixes, groups and `.use()` plugins without asking
   the author to duplicate routes.
4. Layer an AbsoluteJS TypeScript transform ahead of the Elysia AOT transform. It
   recognizes calls to instrumented `handle*PageRequest` helpers and injects
   build-only route metadata. On Elysia 2, an Absolute macro `introspect` hook
   consumes that metadata and attaches a stable private page identity to the
   finalized route. The source route remains unchanged.
5. Use the TypeScript checker to derive the page component/input prop contract and
   its deterministic fingerprint. Elysia's captured schemas describe HTTP request
   and response validation; they cannot recover erased component prop types from
   an Absolute page handler that returns `Response`.
6. Join Elysia's exact finalized route identity with Absolute's page identity,
   framework, client entry, asset graph and prop fingerprint to produce the mobile
   route manifest and archived-producer input.
7. Reuse Elysia's generated AOT handler/validator module inside each producer build,
   while still bundling the corresponding historical application handlers and
   dependencies. The AOT module precompiles dispatch mechanics; it is not itself a
   complete historical producer.

Do not write Absolute metadata into Elysia's `Manifest` tables. In 2.0 beta those
tables have fixed handler and HTTP-validator shapes keyed by method/path/slot, and
are an implementation contract for Elysia's compiler. Macro introspection and the
public finalized route graph are the intended extension points.

The Elysia AOT plugin currently rejects `.mount()` sub-apps because its flat
method/path manifest cannot represent a separately compiled mounted application.
`.use()` composition is supported. AbsoluteJS should diagnose a mounted sub-app
and use a documented non-AOT compatibility path until Elysia supports it; it must
not silently omit those routes.

Elysia 2.0.0-beta.6 is now the AbsoluteJS target baseline. There will not be a
new 1.4 compatibility adapter for mobile route capture. The coordinated ecosystem
migration, exact beta pins, codemod policy, TypeBox boundary, WebSocket/HMR work,
and release gates are defined in [ELYSIA_2_MIGRATION.md](./ELYSIA_2_MIGRATION.md).
Mobile route capture should be implemented only on the finalized v2 route/AOT
contract so it does not create an adapter that is obsolete before mobile ships.

### Ownership of rendering and data

| Concern | Author writes | Browser runtime | Capacitor runtime | Expo native route (v2) |
| --- | --- | --- | --- | --- |
| Route | Normal Elysia/AbsoluteJS route once | Requests route normally | Local router matches captured route and requests its envelope | Expo route maps to same URL/server data contract |
| Parameters/query | Normal route context | Elysia resolves | Same Elysia route resolves | Same Elysia route/data endpoint resolves |
| Server data/authorization | Existing handler/load code | Runs on Bun | Runs on Bun for envelope request | Runs on Bun for native data representation |
| Initial representation | Existing framework page | Streamed SSR HTML | Versioned data/result envelope | Native React component receives typed data/props |
| Client activation | Existing component code | Browser hydration entry | Compatible embedded page entry client-renders; restricted HTML is sanitized | React Native/Expo runtime |
| Navigation | Links/router calls | Browser history/server navigation | Local shell history + envelope navigation | Expo Router/native navigation |
| Application networking | Absolute HTTP/Sync/Auth or diagnosed browser API | Same origin + cookie | Backend origin + mobile auth proof | Backend origin + mobile auth proof |
| Authentication API | `@absolutejs/auth` | HTTP-only cookie session | System-browser PKCE + secure native credentials | Expo AuthSession-style PKCE + secure storage |
| Device API | `@absolutejs/devices` | Standards API/fallback | Capacitor native plugin/fallback | Expo/React Native module |
| Durable local state | Universal storage contract | IndexedDB/storage adapter | native-backed adapter | Expo native adapter |
| Secrets/database | Server code only | Never sent except intentional response data | Never embedded; server remains authoritative | Never embedded; server remains authoritative |
| Offline | Sync collections/packs plus explicit policy for other calls | IndexedDB + optional PWA wake-up | SQLite-backed Sync profile; shell always boots | Expo SQLite-backed Sync profile |

The protocol needs at least three server representations of the same logical
route over time:

1. `text/html` for web SSR.
2. `application/vnd.absolute.page+json` for Capacitor web-rendered pages.
3. A typed data/props representation for an Expo native replacement route. This
   should reuse the same resolved params, auth principal, validation, and loader
   result rather than forcing the native component to scrape HTML.

That third representation is why page handling should be refactored around an
internal route/page result instead of treating a completed HTML `Response` as the
only output the framework can produce.

## Shared local-first data: build on `@absolutejs/sync`

Offline is not a Capacitor feature and should not be hidden inside the mobile
shell. A browser tab can lose Wi-Fi, an installed PWA can be relaunched without a
network, and a Capacitor or Expo process can be suspended and restored. All four
targets need the same data semantics with different persistence and lifecycle
implementations.

The existing `@absolutejs/sync` repository is already the correct substrate, but
the durable profile is substantial enough to call a Sync v3 protocol/storage
generation rather than a thin mobile adapter. It
ships:

- row-level live collections over WebSocket, optimistic mutations, ack/reject
  reconciliation, reconnect backoff, and resumable version/vector cursors;
- separate `MutationStorage` and `CollectionCache` contracts, a localStorage
  queue/cache, and an IndexedDB collection cache;
- server-authoritative atomic mutation frames, transactions, mandatory collection
  authorization, declarative row permissions, schemas/migrations, and CDC;
- framework-neutral observable stores plus React, Vue, Svelte, and Angular
  bindings;
- first-party CRDTs and swappable Yjs, Automerge, and Loro adapters; and
- implemented `SyncPack` registration plus published presence, comments, digest,
  notifications, favorites, counters, mentions, and triage packs.

That is much closer to the desired product than a new cache wrapper. The mobile
work should promote Sync's current opt-in primitives into a durable, runtime-
selected local-first profile. Do **not** create a second mutation queue in
`@absolutejs/devices`, the page shell, or a service worker.

Concrete current limits justify the version boundary: the multiplexed client keeps
its atomic confirmed rows and mutations in memory; single-collection persistence
has crash windows; stored mutation IDs are process-local integers; restored
mutations do not restore their optimistic effect; and replay is explicitly
at-least-once. The Capacitor shell can ship usefully before this generation is
stable. Connected mobile packaging and experimental local-first Sync should have
separate release gates.

### What exists versus what mobile-grade offline still needs

| Concern | Existing Sync behavior | Required product work |
| --- | --- | --- |
| Offline reads | Confirmed collection snapshots can persist to localStorage or IndexedDB | Default durable adapter selection, account/tenant partitioning, quota handling, encryption policy, schema migration, cache eviction, and a normalized multi-collection store |
| Offline writes | Pending mutation name/args persist and replay on reconnect | Stable device-scoped operation IDs, server deduplication receipts, transactional outbox persistence, durable optimistic operation descriptors, dependency ordering, cancellation, and dead-letter/retry UX |
| Reconnect | Exponential retry plus collection version/vector cursor catch-up; full snapshot fallback | Connectivity and app-resume triggers, jitter/reachability probes, auth refresh coordination, bounded catch-up policy, and observable progress |
| Socket authentication | Server can derive context from upgrade headers/cookies; the browser client has no token-supplier/auth-frame contract | Versioned post-connect authentication proof or short-lived single-use socket ticket; never a long-lived token in the URL |
| Reconciliation | Server-authoritative ack/reject and optimistic rollback | Per-mutation conflict metadata, typed conflict results, app-selectable reject/rebase/LWW/CRDT/manual policies, and user-visible remediation |
| Atomic UI | Multiplexed client applies cross-collection server frames consistently | Add durable cache/outbox support to the multiplexed client so offline persistence does not sacrifice consistent frames |
| Process restart | Queue and confirmed rows can survive reload when adapters are supplied | Restore optimistic intent before first paint, prevent duplicate effects after lost acks, resume safely after auth/account changes, and test crash points around every commit |
| Background | Reconnect occurs while the JS client is alive | Small headless `flush()`/`pull()` entry points usable by service workers and native background runners without a DOM or long-lived WebSocket |
| Security | Server permissions scope emitted rows | Per-principal local namespaces, purge/lock on logout or tenant switch, secure key handling, sensitive-field policy, and protection from one account seeing another account's stale rows |
| Observability | Client status/error and server engine metrics/devtools | Queue depth, oldest pending age, last successful push/pull, conflict count, cache bytes, cursor age, adapter health, and replay diagnostics |

The current protocol explicitly provides at-least-once mutation replay and asks
application mutations to be idempotent. That is acceptable as a primitive, but it
is not sufficient as the framework's automatic offline guarantee. AbsoluteJS must
give every operation a durable ID such as `(installationId, operationId)`, persist
server deduplication results for a bounded retention window, and make duplicate
delivery harmless by default. An ack can be lost after the server commits; without
server deduplication, reconnect can repeat a charge, message, or order.

Likewise, JavaScript optimistic callbacks cannot be serialized. The offline API
needs declarative operations that can be replayed after process death:

```ts
const todos = sync.collection(todoCollection);

// Local row changes immediately. The durable operation can be reconstructed
// after a tab reload or mobile process death and reconciled later.
await todos.insert({ id: crypto.randomUUID(), title: 'Book flights' });
await todos.update(id, { completed: true });
await todos.remove(id);
```

Custom mutations remain supported, but a mutation that claims restart-safe
optimism must declare a serializable local reducer/inverse or use a sync pack that
does so. An arbitrary closure can only be optimistic for the current process.

### Data and rendering flow

```text
                         one AbsoluteJS route / one auth principal
                                           |
                    +----------------------+----------------------+
                    |                                             |
              Web HTML/SSR                              Mobile page envelope
                    |                                             |
                    +----------------------+----------------------+
                                           |
                              framework binding / core store
                                           |
                         read and write local materialized data
                                           |
                    +----------------------+----------------------+
                    |                                             |
        Web/PWA persistence adapter                  Native persistence adapter
          IndexedDB (OPFS later)                  Capacitor/Expo SQLite + key store
                    |                                             |
                    +----------------------+----------------------+
                                           |
                     durable outbox + cursor + operation receipts
                                           |
                 foreground / resume / connectivity / best-effort background
                                           |
                         push operations -> Absolute Sync server
                         pull cursor diffs <- Absolute Sync server
                                           |
                     permissions + schema + transaction + dedupe
                                           |
                    application's existing Drizzle/Prisma/database
```

The local database is the interactive read model after it has hydrated. Network
status changes scheduling, not truth: `connected` only means a network interface
exists, not that DNS, TLS, auth, or the backend works. A successful Sync exchange
is the authoritative reachability signal.

When a route loader explicitly declares a Sync collection projection, the page
result may include an authorized bootstrap containing the initial rows and cursor
already produced for the route. The client
commits that bootstrap to its local store, applies its durable optimistic outbox,
then subscribes from the cursor. This prevents the route renderer and Sync client
from fetching the same initial data independently and gives browser SSR,
Capacitor, and Expo the same first-state semantics. AbsoluteJS cannot infer that
arbitrary loader props are durable collection rows.

### Package boundaries

Recommended package layout:

| Package | Responsibility |
| --- | --- |
| `@absolutejs/sync` | Protocol, local-first client, durable outbox/cache contracts, operation IDs/dedupe contract, cursors, conflict policies, SSR/envelope bootstrap, engine, and framework-neutral state |
| `@absolutejs/sync/web` or existing client subpath | IndexedDB implementation, browser lifecycle/connectivity, multi-tab leader election, optional service-worker bridge |
| `@absolutejs/sync-capacitor` | SQLite-backed cache/outbox/receipts, installation identity, Capacitor network/app lifecycle, secure-key integration, and bounded Background Runner bridge |
| `@absolutejs/sync-expo` | Expo SQLite, AppState/NetInfo integration, secure-key integration, and Expo Background Task bridge |
| `@absolutejs/pwa` | Manifest/install, service-worker shell and static-asset caching, web push, and optional Background Sync registration that calls Sync's headless flush API |
| `@absolutejs/devices` | Connectivity/capability signals and generic device APIs; never owns application-data queues or conflict resolution |
| `@absolutejs/sync-pack-*` | Portable feature-level schemas, collections, mutations, permissions, schedules, CRDT declarations, and offline operation policy |

Whether the platform adapters publish as Sync subpaths or separate packages is a
repository/release decision. They must stay behind the same contracts and must not
pull Capacitor or Expo dependencies into ordinary web bundles. The existing
`sync-adapters` repository currently hosts CRDT and cluster-bus adapters; adding
client persistence/lifecycle adapters there is coherent if the naming clearly
distinguishes storage, transport, CRDT, and cluster roles.

Do not create `@absolutejs/offline` for v1. It would either duplicate Sync or become
an ambiguous facade over it. A future convenience preset could be named
`@absolutejs/local-first`, but only if user research shows that installing and
configuring Sync directly is too low-level; its implementation should still be
pure composition.

### Why packs and adapters become a differentiator

A Sync pack is a portable vertical feature, not just a client cache recipe. It can
already bundle owned schemas, readers/writers, permissions, collections, joins,
search/reactive queries, mutations, schedules, and CRDT declarations behind one
`engine.registerPack(pack)` call. With the offline additions, the same pack can
also declare:

- which collections are locally materialized and their retention/size policy;
- serializable optimistic operations and conflict behavior;
- whether sensitive fields may persist, require encryption, or must stay memory-
  only;
- dependencies on host tables and the actor/tenant scope injected by the app;
- bootstrap data required by a route; and
- background eligibility, priority, retry ceiling, and user-visible failure copy.

Today these are primarily server composition packs, not complete portable offline
features. The pack contract still needs a client projection with typed exported
collection/mutation identifiers, local schema/migrations, serializable operations,
retention and sensitivity, conflict UI hooks and framework bindings. Host ACL or
storage placeholders that default permissive or in-memory must block production
release. Only after those requirements are met should documentation promise that
one install produces an offline-capable feature.

That means installing a comments pack can provide live threads, offline drafts,
CRDT body merging, permissions, queued posting, and reconnect behavior on every
framework and runtime without adopting a proprietary backend. A notifications
pack can expose a locally cached inbox and queued mark-read operations; favorites
and triage can remain instantly interactive on a train; a commerce pack can allow
an offline cart but deliberately forbid offline payment capture. Those policies
are feature semantics, so packs are the right owner.

Adapters provide the orthogonal choices without changing application code:

- client persistence: IndexedDB, Capacitor SQLite, Expo SQLite, encrypted/native
  variants;
- server data integration: existing Drizzle, Prisma, PostgreSQL, MySQL, and SQLite
  paths;
- cluster/change delivery: in-memory, PostgreSQL bus, Redis bus, and CDC sources;
- merge engines: first-party CRDT, Yjs, Automerge, or Loro; and
- lifecycle/wake-up: page events, PWA Background Sync when available, Capacitor
  App/Network plus Background Runner, or Expo background tasks.

The standout model is therefore:

> Routes choose representation, packs choose feature/data semantics, adapters
> choose infrastructure and runtime, and the application keeps its own database.

Competitors often require their database, replica, backend, or React-only client.
AbsoluteJS can make the same installed pack work in React, Vue, Svelte, Angular,
HTML/islands, Capacitor, and later Expo while retaining the user's Elysia server,
ORM, and database. That is the strategic benefit the earlier recommendation was
pointing toward.

### PWA and background execution are accelerators, not correctness requirements

`@absolutejs/pwa` already generates a service worker with an offline navigation
fallback and same-origin asset caching. Keep that behavior focused on the app
shell and immutable assets. Add an optional bridge that asks Sync to flush its
outbox from a service worker when the browser supports Background Sync. The
[web API is not universally available](https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API),
so page load, `online`, focus, and visibility resume must also retry.

Capacitor should flush on app start, foreground/resume, a positive network change,
and explicit user retry. [Background Runner](https://capacitorjs.com/docs/apis/background-runner)
may perform short headless bursts, but it is a separate JS environment with limited
APIs and no WebView/DOM; iOS timing is not guaranteed and gives roughly 30 seconds,
while Android periodic work has a minimum interval and vendor battery restrictions.
Use a finite HTTP push/pull cycle, not a permanent WebSocket, and checkpoint after
every accepted operation.

Expo has the same product rule: its
[background tasks](https://docs.expo.dev/versions/latest/sdk/background-task/) are
OS-scheduled and conditional, not a timer guarantee. The app must remain correct
if synchronization happens only on the next foreground.

## Proposed developer experience

### Initial setup

```bash
absolute mobile init
```

The command should:

1. Detect whether mobile config or native projects already exist.
2. Ask only for app display name, reverse-DNS app ID, and platforms when they are not supplied by flags/config.
3. Add a `mobile` block to `absolute.config.ts` using the same safe AST-editing approach as other generators.
4. Install mutually compatible Capacitor core/CLI/platform packages and the AbsoluteJS device packages.
5. Generate `capacitor.config.ts` and add requested platforms.
6. Add safe ignore entries for ephemeral build/live-reload state, but keep `ios/` and `android/` tracked by default.
7. Print the first dev and build commands.

It must be idempotent. It must stop before overwriting any existing native project or non-generated Capacitor config.

Non-interactive CI/scaffold form:

```bash
absolute mobile init \
  --app-id com.example.product \
  --app-name Product \
  --platform ios \
  --platform android \
  --yes
```

### Day-to-day commands

```bash
# The normal project command builds/serves web and mobile when mobile is configured.
bun dev

# Optional explicit native lifecycle commands.
absolute mobile dev [ios|android]
absolute mobile bundle
absolute mobile sync [ios|android]
absolute mobile run <ios|android>
absolute mobile open <ios|android>
absolute mobile build <ios|android>
absolute mobile doctor [ios|android]
absolute mobile doctor [ios|android] --fix [--yes]
absolute mobile doctor release [--json]
absolute mobile explain <route>
```

Behavior:

- Normal `absolute dev` (and therefore a project's `bun dev`) detects mobile config and builds both browser and mobile page entries from one dependency graph. The banner prints the web URL, a mobile-preview URL, the backend URL devices must reach, connection status for running simulators/devices, and a QR/deep link when useful.
- The mobile preview runs the real mobile router, page-envelope protocol, auth/request adapter in a safe browser simulation, and device mocks. It is not merely responsive viewport emulation.
- Normal interactive `bun dev` treats the selected simulator/emulator as a first-
  class output alongside the browser. Once a developer has chosen a default target,
  it boots or reuses that target, installs the debug shell when necessary, launches
  it, streams categorized logs, and attaches it to the same HMR graph. The first run
  is guided and persists a machine-local choice; non-interactive processes, CI, and
  `--no-mobile` do not launch a graphical emulator. Native IDEs are never required
  for the normal loop and are only opened by `mobile open`.
- `mobile dev` starts or reuses that same graph, resolves a device-reachable URL, creates ephemeral live-reload config, syncs it, launches the requested target, forwards termination, and restores production-safe config.
- `mobile dev` is also the explicit target-management form: it can override the
  saved platform/device, run headless, select an OS/API runtime, start more than one
  target, or connect a physical device without changing application code.
- `bundle` performs the deterministic embedded shell/UI/asset/route-manifest build without building a native binary.
- `sync` runs bundle first unless `--no-bundle` is explicitly used, then invokes Capacitor sync.
- `run` runs bundle + sync + native debug launch by default.
- `open` opens the native IDE without mutating native projects.
- `build` produces a release native artifact through Capacitor and native tooling. Signing flags should be forwarded rather than re-invented.
- `doctor` validates Bun/Node compatibility, Capacitor package version alignment, Xcode/CocoaPods or Android/JDK/SDK prerequisites, app identifiers, route/page mapping, native platform presence, deep-link configuration, and unsafe committed live-reload settings.
- `doctor --release` additionally checks deployed-server/runtime compatibility,
  signing, association files, privacy/data declarations, production origins, CSP,
  dependency locks, build/version numbers, forbidden development settings and the
  effective native capability graph.
- `mobile explain <route>` prints its handler/page identity, compatibility tier,
  framework and embedded assets, binary-size contribution, networking findings,
  auth/offline policy, required native capabilities and release blockers.

Every command should print the underlying command at verbose log level and retain a documented `--passthrough`/`--` escape hatch.

### First-class emulator and HMR architecture

The emulator experience is an AbsoluteJS product surface, not an alias for
`cap run`. Capacitor 8 already supplies useful low-level behavior—target listing,
native builds and deployment, live-reload URL injection, and Android
`--forwardPorts`—but it does not provision targets, own readiness and recovery,
coordinate the Absolute page-envelope build, or make one `bun dev` graph truthful.
AbsoluteJS should compose those primitives and invoke official platform tools only
where Capacitor does not expose the required operation.

The default interactive workflow is:

```text
bun dev
  |
  +-- browser: normal AbsoluteJS web app + HMR
  +-- browser: mobile-shell preview + device mocks + HMR
  `-- native: saved/default emulator -> local mobile shell + the same HMR graph
```

On a machine with mobile config but no saved target, the first interactive run asks
whether to configure Android or iOS, shows installed and installable runtimes, and
persists only the target preference in ignored machine-local state. It does not
silently download multi-gigabyte SDKs, accept licenses, create devices, or open an
IDE. After setup, normal `bun dev` launches the chosen emulator by default. The
developer can use `--no-mobile`, `mobile.dev.autoStart: false`, or a non-interactive
environment to suppress graphical launch. `absolute mobile dev` remains the explicit
form for selecting targets, running multiple devices, using a physical device, or
running headlessly.

#### Controller state machine

The controller owns one cancellable session and reports every state in the dev
banner instead of leaving an apparently frozen build:

```text
discover host tools
  -> resolve/provision target
  -> acquire per-target lock
  -> boot or reuse target
  -> wait for OS + package manager readiness
  -> establish dev transport
  -> sync/build/install shell when its native fingerprint changed
  -> launch/deep-link entry route
  -> attach logs, HMR health, screenshots and lifecycle controls
  -> reconnect/relaunch after recoverable target or server failure
  -> restore production-safe native config and release locks on shutdown
```

Every transition must be idempotent and observable. A journal in
`.absolutejs/mobile/dev/<session-id>.json` records the target, child processes,
forwarded ports, files temporarily changed, original hashes and cleanup status.
Startup repairs an incomplete prior session before doing new work. This covers
SIGKILL, host crashes and power loss, where a signal-only cleanup hook cannot help.
Source `capacitor.config.ts` is never given `server.url`. The copied native config is
changed atomically for a dev session and restored from the journal; release doctor
also rejects any live-reload URL, cleartext setting, HMR client or session marker.

#### HMR transport

The native WebView must load an AbsoluteJS mobile development entry, not the normal
SSR website. The dev server exposes a reserved mobile-shell endpoint from the same
compilation graph. It serves the real local router, mobile page-envelope client,
framework client entries, source maps, error overlay, and a development manifest
whose backend origin points to the running dev server. Production continues to
start from embedded files and never sets Capacitor `server.url`.

For Android emulators, the preferred transport is:

```text
WebView http://127.0.0.1:<dev-port>/__absolute/mobile
              |
        adb reverse tcp:<dev-port> tcp:<dev-port>
              |
        host AbsoluteJS dev server
```

This avoids LAN address selection, firewall prompts and the emulator-specific
`10.0.2.2` address, and it makes the existing location-relative `/hmr` WebSocket and
`/hmr-status` recovery path work unchanged. The controller scopes `adb` operations
to the selected serial and verifies both HTTP and WebSocket reachability from the
app. iOS Simulator uses the Mac host loopback and receives the same URL. A physical
device uses an explicitly selected LAN address with the server bound to an external
interface, trusted local HTTPS when required, or an opt-in tunnel; a QR code is a
pairing convenience, not an authentication mechanism.

The dev endpoint issues a random, short-lived session credential and accepts only
the selected dev origins/targets. It must not expose privileged production secrets,
and logs must redact auth headers, codes and tokens. Native auth callbacks and deep
links still return to the installed app and are then routed to the dev server by the
normal installed-app transport.

Changes are classified before work is scheduled:

| Change | Action |
| --- | --- |
| Page/component/CSS/public web asset | Existing framework HMR or targeted mobile shell reload; no native build |
| Route/page contract or server handler | Rebuild the dev envelope producer and update the route manifest; preserve the installed shell when compatible |
| Absolute/mobile config without native projection changes | Restart or refresh the affected dev service only |
| Capacitor plugin, permission, entitlement, Gradle/Swift package or generated native projection | `cap sync`, native debug rebuild, reinstall and relaunch |
| User Kotlin/Swift/native resource change | Native debug rebuild, reinstall and relaunch |
| App identifier, signing identity or platform directory change | Stop with a targeted migration/reinitialization diagnostic |

The controller fingerprints the effective native input graph, not merely
`package.json`, so unchanged runs skip Gradle/Xcode work. Rebuild requests coalesce;
the last successful app remains running while compilation errors are shown in both
the terminal and WebView overlay.

#### Platform providers

Android support uses the official SDK tools and keeps their state visible:

- discover Android Studio and standalone SDK layouts plus `ANDROID_HOME` and
  `ANDROID_SDK_ROOT`; verify JDK, `sdkmanager`, `avdmanager`, `emulator`, `adb`,
  platform/build tools and hardware acceleration;
- list existing AVDs and attached devices, create a namespaced AVD from a pinned
  device profile/system-image/API/ABI, and ask before SDK downloads or license
  acceptance;
- boot with Quick Boot for daily work or cold/wipe-data modes when requested, wait
  for `adb`, `sys.boot_completed`, boot animation and package manager readiness,
  then install/launch by selected serial;
- support windowed and CI/headless modes, snapshots, screenshots/video, logcat,
  network/location/battery controls, data reset and deterministic parallel ports.

iOS support is available only on macOS and uses the Xcode installation selected by
`xcode-select`:

- verify Xcode, licenses, command-line tools, required simulator runtimes, CocoaPods
  or Swift Package Manager, and signing only when a physical-device/release path
  needs it;
- use `xcrun simctl` to list/create/boot/bootstatus/install/launch/openurl,
  screenshots/video, logs, status-bar overrides, privacy grants and data reset;
- use `xcodebuild` with an isolated DerivedData path and the exact simulator UDID;
  never infer a target from display name when duplicate runtime versions exist.

Windows, Linux and WSL require separate host adapters rather than path guessing.
On WSL, the preferred v1 path is a Windows-host Android SDK/emulator broker with
translated paths and an explicitly discovered `adb.exe`; native Linux KVM is used
only when `/dev/kvm` and the Linux SDK are actually available. Doctor explains
which side owns the emulator and tests port reachability across the WSL NAT boundary.
Local iOS simulation is never advertised off macOS; Linux/Windows developers can
use browser mobile preview, Android, physical-device/cloud workflows, and a remote
macOS runner. The implemented bring-your-own-Mac protocol pairs a user-controlled
SSH host without storing credentials, synchronizes atomic project snapshots,
preserves Mac-owned dependency/DerivedData/native caches, and carries the existing
iOS controller over a versioned JSON-lines channel. One reverse SSH tunnel makes
the remote Simulator's loopback HMR connection reach the developer's local Bun
server. The exact local AbsoluteJS remote-agent bundle is uploaded into a
protocol-versioned, content-addressed cache and SHA-256 verified before execution;
it never locates AbsoluteJS through the application's `node_modules` tree. This
provider boundary is intentionally independent of the future metered hosted-Mac
adapter in AbsoluteJS PaaS.

#### Product-level diagnostics and testing

`absolute mobile doctor` emits machine-readable checks with remediation commands,
download sizes and whether each action is automatic, guided or manual. It
distinguishes missing tool, wrong version, missing runtime, unavailable
virtualization, boot timeout, unauthorized physical device, unreachable dev server,
failed HMR WebSocket, stale native config and app crash. `absolute mobile targets`
lists provider, platform, OS/API, architecture, state and stable target ID.

The implemented guided setup form is `absolute mobile doctor android --fix`. It
prints the complete machine-change plan before asking for confirmation, refuses to
prompt without a TTY, and supports explicit `--yes` for automation. Android setup
downloads a pinned Google command-line-tools archive, verifies its published
SHA-256 checksum, installs the SDK/emulator/API packages, presents SDK licenses for
acceptance (or accepts them only under `--yes`), and idempotently creates an
`AbsoluteJS_API_36` AVD. The managed SDK is isolated under `.absolutejs` in the
user profile. WSL deliberately installs the Windows toolchain under Windows Local
AppData and invokes its `.exe`/`.bat` tools through interop; it does not silently
create an unusable Linux emulator without KVM. `--json` remains read-only and is
incompatible with `--fix`. On macOS, `doctor ios --fix` uses Xcode's supported
platform-runtime downloader after Xcode itself is present; other hosts fail with a
clear platform requirement.

The first implemented unified-development slice now connects configured Android
apps to normal interactive `absolute dev`/`bun dev`. Once the web server is ready,
the CLI reuses or boots the managed `AbsoluteJS_API_36` AVD, runs Capacitor sync,
establishes `adb reverse` loopback forwarding, builds and installs the debug APK,
and launches the app against the same HMR server. The first run offers the existing
guided toolchain installer and managed native-project creation; `--no-mobile`,
`ABSOLUTE_NO_MOBILE=1`, CI, and other non-interactive runs remain web-only. WSL uses
the Windows SDK/emulator and a PowerShell Gradle broker. Live-reload changes to the
copied native Capacitor config are journaled and restored on normal shutdown,
startup failure, cancellation, or the next run after a crash. The managed emulator
stays warm after shutdown for fast subsequent starts. Physical iOS development is
now a first-class Phase 4 target through
`absolute dev --ios-device <identifier>`: AbsoluteJS uses Xcode automatic signing,
`devicectl` validation/install/console launch, a device-reachable LAN origin,
native fingerprint/install caching, redacted logs, timing telemetry, relaunch,
and the existing projection repair journal. Trusted local HTTPS reuses `dev.https`:
certificates are regenerated only when a required LAN identity is absent, Android
debug builds receive an app-scoped debug-only CA projection, and local or remote
iOS Simulators receive the public CA through `simctl keychain`. Explicit
`absolute dev --android-device <serial>` development uses the selected LAN address
without changing application code, while the normal managed emulator retains its
faster `adb reverse` loopback path. Physical iOS sessions expose only the public
CA through an unguessable ephemeral enrollment URL and retain Apple's required
on-device profile and full-trust approvals. A physical device attached to a paired
Remote Mac uses a remote LAN TCP relay into a separately bound SSH reverse tunnel;
the dev server and private CA key remain on the developer host. The SDK-free
mobile-preview UI is now implemented with the explicitly documented platform
limitations above.

Android startup now implements the persisted native-delta fast path. After sync and
temporary development transport projection, AbsoluteJS content-hashes the effective
Android project plus every native dependency resolved from
`capacitor.settings.gradle`. Gradle/build outputs and the live web bundle are
excluded; manifests, generated plugin registration, Gradle inputs, native source,
resources, dependency source, and the effective development server config are not.
The cache is accepted only when that fingerprint and Android's current installed
package identity both match the last successful install for the selected device.
An uninstall, external replacement, plugin edit, native customization, port/entry
change, malformed cache, or unavailable package metadata therefore fails closed and
rebuilds. Ordinary restarts and web-only edits skip both Gradle and `adb install`,
while still running the cheap Capacitor projection check and launching the app.
Cache records live under `.absolutejs/mobile/cache`, outside the crash-recovery
journal, and are replaced atomically only after installation succeeds.

Native development now reports both startup and live-update latency as first-class
AbsoluteJS diagnostics. Android startup prints the total time and an ordered phase
breakdown for Capacitor sync, temporary config, fingerprinting, emulator readiness,
ADB forwarding, package validation, Gradle, install, launch and log attachment;
fingerprinting overlaps emulator readiness, and the controller reuses the selected
serial and installed-package UID instead of repeating ADB discovery. Framework HMR
acknowledgements carry a monotonic update ID plus the client target, so delayed
responses remain correlated with the source edit that produced them. Native terminal
lines are distinct from browser lines and show total, server and client application
time, for example `[hmr:android] ... applied in 63ms; server 19ms, client 44ms`.
The corresponding opt-in telemetry records target/framework and numeric phase
durations or cache status only; it excludes route URLs, source paths, application
IDs, device serials, signing data and log contents. Real API 36 acceptance measured
a 2.04 second warm Android connection with Gradle and APK installation skipped.

The native-target HMR contract now covers every AbsoluteJS page family rather than
only React. Angular, React, Vue, Svelte, HTML and HTMX acknowledge successful
application from the WebView with target, update ID, update kind, outcome, server
time and client time. Ember explicitly acknowledges its current full-page reload
fallback, so the terminal and telemetry distinguish a reload from an in-place
apply instead of reporting a false success. CSS swaps retain the old stylesheet
until the replacement loads, ignore unrelated cross-origin stylesheets, and no
longer let the generic `rebuild-complete` path reload `styles`, `assets`, or
Tailwind changes before their update arrives. Development-only Ember SSR responses
now receive the same target-aware HMR client; production responses do not.

Browser conformance runs the real generated clients with
`__absolute_target=capacitor-android`, changes each framework source, verifies the
visible result, and enforces a bounded native acknowledgement. It also verifies
that a runtime error uses the branded overlay and that the next valid edit clears
the overlay without restarting the dev server. The harness uses one dev graph and
isolated browser contexts, matching the intended multi-route `bun dev` workflow
while preventing framework runtimes from contaminating one another. Real Android
acceptance remains the transport/device gate; this matrix is the fast deterministic
framework gate that runs without an SDK.

That transport/device gate is now implemented too. The opt-in
`bun run test:native:android` suite boots or reuses AbsoluteJS's managed API 36
emulator, builds and installs the actual Capacitor application, attaches directly
to its WebView through ADB's Chrome DevTools socket, and exercises ten behavioral
cases: Angular, React, Vue, Svelte, HTML, HTMX, Ember's explicit reload fallback,
CSS, overlay recovery, and background/relaunch. All ten pass in one native session.
The fixed default test port preserves the native fingerprint across reruns; the
measured warm run reached a ready emulator in 3.62 seconds with Gradle and APK
installation skipped, then completed the matrix in 49.32 seconds. This suite is
deliberately opt-in so ordinary unit/integration inventories never require an SDK.

The same CDP bridge is available interactively as
`absolute mobile test android`. Repeating `--route /path` checks any set of real
routes in the installed app, while `--wait-for-hmr` waits for a source save and
requires a correlated client-apply acknowledgement. `--json` produces a machine
report; failures preserve redacted diagnostics plus a WebView screenshot under
`.absolutejs/mobile/test-artifacts`. Its telemetry contains only provider,
platform, duration, route count, success, and whether HMR was requested—never app
identity, route, device serial, or source content.

`absolute mobile test android --report` now uses the same versioned native-test
report contract as iOS. It captures the checked route set, target/tool versions,
launch and optional correlated HMR timings, a screenshot, and matching Markdown
and JSON in a timestamped project-local directory. Interactive capability, Auth,
Sync, background, signing, and store rows remain `NOT_RUN` until a tester performs
them; AbsoluteJS never promotes an automated WebView observation into a broader
manual pass.

Implementation checkpoint (August 27, 2026, installed Android upgrade slice):
the production embedded-app fixture now performs a real state-preserving
`adb install -r` from versionCode N to N+1. Before replacement it provisions
native PKCE Auth, an account-isolated Sync SQLite snapshot, and one deliberately
unacknowledged durable mutation. After replacement and process relaunch it proves
silent credential restore, SQLite-backed Sync restore, and recovery of the same
pending outbox record without inspecting or recording any secret or application
payload. The same run exercises compatible N+1 and N+2 server states, the typed
N+3 update-required screen, and an atomic server rollback back to a renderable
state. It writes a sanitized timing/outcome artifact and the shared native report
contract now has automated upgrade/state/compatibility rows plus explicit manual
UPGRADE and COMPAT checks.

The reusable conformance guard compares Android UID, data directory, first-install
timestamp, and increasing versionCode, so uninstall/reinstall cannot masquerade as
an upgrade. Android debug development installs permit version downgrades so a test
or local version bump cannot wedge the next `bun dev`; production release installs
remain monotonic. WebView discovery now waits through transient `about:blank`
targets created during Activity replacement. Run the focused gate with
`bun run test:native:android:upgrade`; the aggregate Android native suite includes
the same case through its embedded-bundle file.

Implementation checkpoint (August 27, 2026, generated SQLite migration slice):
the installed-APK gate now starts from a genuinely fresh encrypted database,
persists a confirmed row and pending intent, proves both survive a v1 process
restart, then builds migration plans from temporary application
`absolutejs.sync.localSchema` metadata. APK N+1 deliberately attempts
`rename-field label -> id` against a row that already owns `id`; the shell reports
only sanitized `INVALID_PLAN` state and SQLite rolls the transaction back. APK
N+2 corrects the same v2 step to `label -> title`. Without clearing app data it
reaches stored/target schema 2, restores Auth, and retains the pending outbox.
That recovery would be impossible if the failed transaction had advanced the
ledger or partially changed the row. The test writes a sanitized
`android-sync-migration-conformance.json` artifact and native reports include
automated/manual migration and rollback rows.

The gate also exposed and fixed fresh native schema initialization:
`@absolutejs/sync-capacitor` 0.9.2 sends each idempotent DDL statement through
Capacitor SQLite separately, with a regression test for a truly empty database.
AbsoluteJS proactively prepares schema state in the shell and exposes only
`preparing`, ready versions, or a typed failure code through a realm-stable symbol
and `absolute:sync-schema` event. Diagnostic artifacts discard verbose native
plugin console traffic and redact credential-shaped values.

Real WSL2/Windows acceptance established the host boundary more precisely. Gradle
cannot reliably build a project directly from a `\\wsl.localhost` UNC path, so the
broker mirrors the generated Android project into a dedicated Windows Local AppData
build directory, preserves Gradle/build caches between runs, and builds there. It
also mirrors every native Gradle dependency referenced by
`capacitor.settings.gradle`, rewrites only the managed mirror's dependency paths,
and explicitly supplies `ANDROID_HOME`/`ANDROID_SDK_ROOT` inside PowerShell. The
developer's committed native tree remains the source of truth and is never rewritten
to Windows paths.

The same acceptance run installed and cold-booted the managed API 36 AVD with WHPX,
built 93 Gradle tasks, installed and launched a real debug APK, and rendered the
ordinary dynamic route `/account/Ada` with request-time props. Android HTTP live
reload temporarily enables cleartext traffic only in the copied native development
config/manifest; the crash journal restores both files on normal shutdown, startup
failure, cancellation, or stale-session repair. A normal React page edit then
updated the already-open WebView without Gradle, reinstall, or relaunch. On Bun
builds that do not yet implement `Bun.Transpiler` Fast Refresh registrations,
AbsoluteJS imports the freshly transformed page module and uses a generated React
root remount hook; patched Bun keeps the state-preserving Fast Refresh path. Native
output directories are excluded from the web watcher so Capacitor sync and Gradle
cannot trigger a restart storm.

The Android session now remains observable after launch instead of becoming a
fire-and-forget child process. It publishes typed lifecycle states through sync,
configuration, boot, transport, build, install, launch, log attachment, readiness,
failure and cleanup. Normal interactive `bun dev` exposes `d`/`device` to report the
selected serial, state and HMR port, plus `relaunch` to bring the installed app back
to the foreground without rebuilding it. Native logs stream into the same terminal
and session log with an `[android]` category and parsed Android severity/tag. The
controller scopes `logcat` to the installed package UID so unrelated device logs are
excluded and the stream survives app process replacement. The default filter keeps
all Capacitor/JavaScript console output and Chromium information while suppressing
unrelated verbose/debug chatter below warning severity. ANSI/control sequences,
authorization credentials, cookies, OAuth codes and common token/password fields
are redacted before output. The log process is owned by the cancellable session and
is stopped before reverse-port and native-config cleanup.

Android lifecycle/rebuild hardening is now implemented as a second native
conformance layer. A debounced watcher fingerprints the effective native graph;
page, CSS and public-asset changes remain on the HMR path and never invoke Gradle,
while native source, plugin/dependency, Capacitor config, Absolute config, package
manifest or lockfile changes close the temporary projection, sync, rebuild/install
when the fingerprint requires it, and relaunch without restarting the Bun server.
Changes arriving during a rebuild are coalesced, and a failed rebuild is retryable
by the next native edit instead of leaving the dev process wedged. Successful and
failed native rebuild telemetry contains only host/provider/platform, cache status,
timings and whether a root input changed; source paths are never transmitted.

The opt-in lifecycle suite now proves server kill/restart and WebSocket recovery,
Android process death plus relaunch/reattachment, a real watched Java edit through
Gradle/install/relaunch with the same Bun PID, and a no-op native rebuild that skips
Gradle and installation. It enforces configurable cold, warm, reconnect and native
rebuild budgets. The first API 36 hardening run passed all five cases: no-op session
replacement took 2.21 seconds, server reconnect 7.64 seconds, process-death recovery
14.23 seconds, and the watched native rebuild session 32.74 seconds (45.6 seconds
end-to-end including observation). `bun run test:native:android` runs this lifecycle
suite before the ten-case framework HMR suite; the HMR suite runs second so its
restored sources leave the persisted native fingerprint clean.

`absolute mobile doctor release [--json]` now fails closed when an Android dev
journal is active, the packaged Capacitor config contains a server URL, cleartext
transport or navigation allowlist, the manifest explicitly permits cleartext, or
packaged assets contain an HMR client marker. It passes only after dev cleanup has
restored the production projection. Platforms without implemented release checks
also fail closed rather than receiving a misleading green result.

Implementation checkpoint (August 22, 2026): the iOS development provider now
mirrors the Android lifecycle behind native platform-specific commands. On macOS,
normal interactive `bun dev` reuses or creates an `AbsoluteJS iPhone` on the newest
installed iOS runtime, synchronizes Capacitor, journals a temporary localhost
configuration and ATS development exception, boots the exact target by UDID,
incrementally builds into persistent isolated DerivedData, installs, launches, and
streams redacted native logs. Its fingerprint excludes copied web assets so page
and CSS edits stay on HMR while Swift, entitlement, native resource, plugin,
configuration, package, and lockfile changes coalesce into sync/build/install/
relaunch without restarting Bun. Warm sessions validate the installed app
container and skip both Xcode and installation.

The server now counts connected HMR clients by normalized target without retaining
application identity. `absolute mobile test ios` uses that public development
status plus `simctl` launch/screenshots; `--wait-for-hmr` correlates the existing
client acknowledgement with the server log and reports the same server/client
timing split as Android. Startup, build, install, rebuild, HMR, success, and cache
telemetry remain provider/platform/timing-only. An opt-in
`bun run test:native:ios` gate exercises cold/warm startup, React and CSS HMR,
termination/relaunch, server reconnect, native rebuild, cleanup, and screenshots.
The controller, crash repair, caching, command construction, target parsing,
redaction, watchers, and HMR correlation are covered with fake Xcode/`simctl` on
non-macOS CI; the real gate must pass on the partner macOS machine before this
checkpoint is called operational.

Implementation checkpoint (August 28, 2026): physical-device acceptance is now
first class through
`absolute mobile test ios --device DEVICE_IDENTIFIER --report`. It binds the
test to the identical selector stored by the running `bun dev --ios-device`
session, requires trusted local HTTPS, validates device availability and the
installed bundle through `devicectl`, terminates and relaunches the app, and waits
for the native HMR client to reconnect. The same command executes lifecycle
inspection on the exact paired Remote Mac recorded by the dev instance, while
HMR returns through the existing relay. `--wait-for-hmr` adds a tester-controlled
page/CSS edit and correlated timing without mutating application source. Reports
use only the generic `physical-device` target and retain no selector, UDID,
inventory, signing output, device logs, or screenshot. Machine-observable checks
are filled automatically; signing/trust UI, visible rendering, Auth/Sync state,
network interruption, native edits, crash cleanup, and physical screenshots
remain explicit partner checklist work.

`absolute mobile build android [server-entry]` now owns the complete production
Android path. It repairs an interrupted development projection, runs the same
production assets/server/route-contract preparation as `absolute prepare`, writes
and verifies the generated Capacitor configuration, synchronizes Android, applies
native deep-link declarations, runs Android-scoped release transport checks, and
invokes Gradle `bundleRelease`. The normal result must pass `jarsigner` verification;
`--unsigned` is an explicit non-publishable escape hatch, not a signing mode.
Signing remains in the committed Android Gradle project or injected Gradle/CI
properties, so passwords and keystore paths never enter Absolute config, shell
arguments, telemetry, or release metadata.

Each AAB is copied into
`.absolutejs/mobile/releases/android/amobile_android_<sha256>/app-release.aab`
with an immutable `release.json`. Its secret-free metadata links the native bytes
and SHA-256 release identity to the embedded `appBuild`, runtime, application ID,
engine, platform, artifact type, size, and verified signing state. This intentionally
matches the content-addressed `{ releaseId, sha256, bytes }` vocabulary used by
`@absolutejs/deploy` without treating a native binary as a server source archive.
`--outdir` can relocate this release store within the project, while
`--web-outdir` independently selects the production Absolute build directory.

Implementation checkpoint (August 22, 2026): `@absolutejs/deploy` 0.22 adds a
provider-neutral native release registry over the structural `@absolutejs/blob`
contract. It re-hashes the local AAB, fails closed on unsigned builds by default,
streams content-addressed artifacts once, and manages `internal`, `beta`,
`production`, or application-defined channels as small mutable pointers. Channel
rollback changes only the pointer and never rebuilds or copies the retained AAB.
Application IDs are hashed in object keys, while release records retain the full
identity required for validation.

`absolute mobile publish android [--registry ./mobile.release.ts] [--channel name]`
now composes the complete workflow: production build, signing verification,
immutable local installation, remote registry publication, and optional channel
promotion. The project-local module default-exports a Deploy native release
registry and may construct any local/S3-compatible Blob adapter from environment
credentials. AbsoluteJS validates that the module stays inside the project and
that its result is the exact release just built. Credentials, registry module
paths, application IDs, release IDs, object keys, and channel names are excluded
from telemetry.

The conventional module name is `mobile.release.ts`, so `--registry` is needed
only when an application keeps deployment wiring elsewhere.

```ts
// mobile.release.ts
import { createNativeReleaseRegistry } from '@absolutejs/deploy/native-release';
import { s3BlobStore } from '@absolutejs/blob/s3';

export default createNativeReleaseRegistry({
	store: s3BlobStore({ client, bucket: process.env.RELEASE_BUCKET! })
});
```

This same command is the CI primitive; CI supplies Gradle signing properties and
Blob credentials through its secret store rather than generating a second build
workflow. Google Play remains a provider adapter above the registry. The Android
Publisher edit flow uploads the AAB, returns its embedded `versionCode`, assigns
that code to a track, validates the edit, and commits it. The adapter must persist
a receipt by `{ releaseId, provider, package, track }` before automatic retries so
a successful commit cannot be followed by an unsafe duplicate upload.

Implementation checkpoint (August 22, 2026): `@absolutejs/deploy` 0.23 adds the
Google Play provider adapter and `absolute mobile publish android` accepts an
explicit Play distribution intent. The project module composes the same native
registry and BlobStore used in the preceding checkpoint:

```ts
// mobile.release.ts
import { createGooglePlayReleasePublisher } from '@absolutejs/deploy/google-play';
import { createNativeReleaseRegistry } from '@absolutejs/deploy/native-release';
import { s3BlobStore } from '@absolutejs/blob/s3';

const store = s3BlobStore({ client, bucket: process.env.RELEASE_BUCKET! });

export default createGooglePlayReleasePublisher({
	receiptStore: store,
	registry: createNativeReleaseRegistry({ store })
});
```

The Play-aware module performs a short preflight edit, finds the highest bundle
version known to Play, and returns the next `versionCode`. That allocation is
persisted against a full build identity derived from the web `appBuild` and the
source-owned Android/native dependency fingerprint. A retry therefore rebuilds
the exact same app with the same code, while either web or native source changes
allocate a new one; promoting that same binary to another track also retains its
code. AbsoluteJS injects the result through Android Gradle Plugin's version-code
property and signs it into `release.json`; the adapter then requires the upload
response to return that exact embedded code. Applications never edit
`build.gradle` merely to ship their next update. Publication for one package is
serialized in CI because Play exposes monotonic codes but no reservation API.

```sh
# Complete internal release
absolute mobile publish android --play-track internal

# Start and later increase a production staged rollout
absolute mobile publish android --play-track production --play-rollout 0.1
absolute mobile publish android --play-track production --play-rollout 0.5

# Halt, resume, then complete the same retained AAB without re-uploading it
absolute mobile publish android --play-track production --play-status halted --play-rollout 0.5
absolute mobile publish android --play-track production --play-status in-progress --play-rollout 0.5
absolute mobile publish android --play-track production --play-status completed
```

Optional release controls are `--play-name`, repeatable
`--play-notes language=text`, `--play-update-priority 0..5`, and
`--play-hold-review`. Commits default to Google's `ERROR_IF_IN_REVIEW` behavior;
only the explicit `--play-cancel-existing-review` flag permits cancellation of
an existing review. This prevents unattended CI from silently replacing work
already under review.

The adapter persists integrity-checked `editing`, `uploading`, `commit-pending`,
and `committed` receipts before the corresponding effects. It reuses an
unexpired edit and resumable upload session after interruption. If the commit
response is lost, it opens a fresh edit and reconciles the bundle SHA-256,
embedded version code, and track intent before declaring success. A resumed
uncommitted edit is deliberately not treated as provider state, closing the
classic crash-after-track-update hole. Track and package identity are hashed in
receipt keys; credentials, edit IDs, upload-session URLs, package names, tracks,
release IDs, rollout fractions, and version codes are excluded from telemetry.

Google setup remains an external account prerequisite: enable the Google Play
Developer API, create a service account, and grant only the required app release
permissions in Play Console. The adapter uses Application Default Credentials
and the `androidpublisher` OAuth scope; it never accepts credential material on
CLI flags.

Implementation checkpoint (August 22, 2026): the iOS counterpart produces a
signed App Store IPA with `absolute mobile build ios` and publishes it with
`absolute mobile publish ios`. Applications declare the human-facing marketing
version once as `mobile.ios.version`; AbsoluteJS derives a complete build identity
from the embedded web build, source-owned iOS fingerprint, and that version, then
asks the App Store Connect adapter for a stable monotonically increasing integer
build number. Page and route code remains unchanged.

Implementation checkpoint (September 1, 2026): the same iOS build and publish
commands now use the default paired Remote Mac automatically on Windows/Linux,
or an explicit host through `--remote <profile>` on any platform. AbsoluteJS
syncs source and the generated web bundle separately, regenerates either the
Capacitor or Expo native layer on the Mac, performs release validation and Xcode
export through the content-addressed agent, and streams the IPA back for an
independent local byte-count/SHA-256 check before immutable installation. The
release adapter, App Store credentials, and TestFlight upload stay on the
developer computer; signing identities stay on the Mac. A protocol handshake
lets the local adapter allocate the stable build number from the remote native
fingerprint without exposing either credential set.

Reliability checkpoint (September 1, 2026): Remote Mac releases now acquire an
atomic project-scoped lease before either source snapshot changes. A random
owner token protects 15-second heartbeats and cleanup; a missed two-minute
window allows the next command to quarantine and replace the stale lease
atomically. Concurrent releases therefore fail before synchronization or Xcode,
while SIGINT/SIGTERM cancels SSH/Xcode and releases ownership. Unique native
staging directories and the existing hash-verified immutable stores remain the
artifact transaction boundary. `mobile remotes inspect` reports redacted cache
and lease totals, and explicit `mobile remotes clean --yes` removes only
abandoned staging directories older than one day. Unit coverage exercises busy
owners, stale recovery commands, token-guarded heartbeat/release, cancellation,
and safe cleanup; real sleep/disconnect/Xcode acceptance is added to the partner
macOS checklist.

```ts
// absolutejs.config.ts
export default {
	mobile: {
		appId: 'com.example.product',
		appName: 'Product',
		ios: { version: '1.4.0' },
		server: { productionOrigin: 'https://api.example.com' }
	}
};
```

The source-owned Capacitor workspace is archived with Release configuration for
a generic iOS device. AbsoluteJS injects `MARKETING_VERSION` and
`CURRENT_PROJECT_VERSION`, verifies the archived application with `codesign`,
exports with Xcode's `app-store-connect` method, hashes the IPA, and installs it
immutably as
`.absolutejs/mobile/releases/ios/amobile_ios_<sha256>/App.ipa`. Release doctor
fails before signing if the generated Capacitor config still points at a dev
server, packaged assets contain HMR, Info.plist permits arbitrary network loads,
or the marketing version is absent.

The App Store Connect adapter uses Apple's direct Build Upload API rather than a
Transporter subprocess. It creates or reconciles the exact build upload, uploads
Apple-provided byte ranges, commits the source SHA-256, waits for a valid processed
build, writes localized What-to-Test text, and assigns the build to requested
TestFlight groups. Integrity-checked receipts retain build-upload, file, and build
IDs across crashes, but never retain Apple's time-limited signed upload URLs.

```sh
# Registry only or an internal TestFlight group
absolute mobile publish ios --channel internal
absolute mobile publish ios --testflight-group Employees

# External beta: review is always explicit
absolute mobile publish ios \
	--testflight-group 'External Beta' \
	--testflight-notes 'en-US=Test offline sync and sign-in' \
	--testflight-submit-review
```

App Store Connect API credentials live in the project release module or its
secret provider, never CLI flags. Adding an external group alone does not submit
review. `--testflight-submit-review` is separate because Apple requires beta app
metadata, allows only one build of a version in review at once, and limits beta
review submissions. As with Play, CI must serialize publication for one app
because Apple exposes monotonic build history but no atomic number reservation.

Capacitor 8's SystemBars plugin legitimately owns native safe-area variables on
the document root. Absolute's browser JSX runtime now marks `<html>` hydration as
safe only when Capacitor reports a native platform, retaining full hydration
diagnostics on the web and requiring no page-author changes. Android log streaming
filters only Capacitor's known pre-DOM null diagnostic while retaining SystemBars;
disabling inset handling is not used because it changes edge-to-edge layout on
modern Android.

The first framework-neutral adaptive-shell layer is now implemented. Every
embedded framework receives normalized safe-area, keyboard, viewport, network,
platform, form-factor, and reduced-motion state through root CSS variables/data
attributes and `absolute:adaptive-shell-change`. Keyboard and System Bars are
implicit shell capabilities, so mobile sync provisions them without page imports.
Expo forwards native safe-area changes into the same contract. The shell restores
the contract after HTML/HTMX document replacement, coordinates automatic system-
bar appearance, and owns accessible loading/offline announcements. It does not
apply padding or restyle author content. See `docs/MOBILE_ADAPTIVE_SHELL.md`.

The implemented Android controller is dependency-injected so its state machine,
command construction, cancellation and crash recovery are unit-testable without an
SDK. Its session boundary is designed to sit behind the provider-neutral controller
that will also coordinate iOS and later providers. Integration tests use fake
`adb`/`simctl` executables before real Android and macOS CI lanes. Native acceptance tests measure first boot, warm
boot, no-op restart, web-only HMR, CSS HMR, server restart recovery, native-plugin
rebuild, app crash/relaunch and Ctrl-C/SIGTERM/stale-journal cleanup. A later
automation adapter may use Maestro if the Capacitor WebView and permission-dialog
spike passes; emulator orchestration must not be coupled to a test-runner vendor.

The package ownership is deliberate: `@absolutejs/devices` contains app-facing
runtime capabilities and adapters, while the emulator controller starts in
AbsoluteJS core/mobile CLI (and may later move to `@absolutejs/mobile-capacitor`).
Host SDK management must never enter browser, SSR or installed application bundles.

### Proposed v1 config

```ts
import { defineConfig } from '@absolutejs/absolute';

export default defineConfig({
  // Existing AbsoluteJS settings...
  sync: {
    localFirst: true,
    // Runtime adapter is selected by the build target. Collection retention,
    // encryption, and conflict policies come from app definitions/sync packs.
    background: 'best-effort'
  },
  mobile: {
    engine: 'capacitor', // default; may be omitted
    appId: 'com.example.product',
    appName: 'Product',
    platforms: ['ios', 'android'],
    entry: '/',
    server: {
      productionOrigin: 'https://api.example.com'
    },
    bundleDirectory: '.absolutejs/mobile/web',
    nativeProject: {
      mode: 'source',
      directory: 'mobile'
    },
    shell: {
      offlineFallback: '/offline'
    },
    deepLinks: {
      scheme: 'product',
      hosts: ['example.com'],
      apple: {
        // Application Identifier Prefix; often, but not always, the Team ID.
        appIdPrefix: 'ABCDE12345'
      },
      android: {
        // Include the Play App Signing fingerprint for Play-distributed builds.
        sha256CertificateFingerprints: ['14:6D:...:E5']
      }
    },
    capacitor: {
      // Typed, deliberately narrow passthrough. AbsoluteJS owns webDir and
      // rejects production server.url/cleartext/allowNavigation here.
      ios: {},
      android: {},
      plugins: {}
    }
  }
});
```

Type shape:

```ts
type MobileConfig = CapacitorMobileConfig | ExpoMobileConfig;

type CapacitorMobileConfig = {
  engine?: 'capacitor';
  appId: string;
  appName: string;
  platforms?: readonly ('ios' | 'android')[];
  entry?: string;
  server: {
    productionOrigin: string;
  };
  bundleDirectory?: string;
  nativeProject?: {
    mode?: 'source';
    directory?: string;
  };
  shell?: {
    offlineFallback?: string;
  };
  deepLinks?: {
    scheme?: string;
    hosts?: readonly string[];
    apple?: { appIdPrefix: string };
    android?: { sha256CertificateFingerprints: readonly string[] };
  };
  capacitor?: AbsoluteCapacitorOverrides;
};
```

Rules:

- The server route graph is discovered automatically. There is no required route list and dynamic parameters are resolved normally at request time.
- `entry` only selects the initial URL; it does not limit which routes are available.
- `productionOrigin` is the deployed AbsoluteJS origin for page envelopes and relative API/form/HTMX requests. Environment-specific public configuration may override it without rebuilding application source.
- Production serves `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json` directly with JSON content types and no redirects. `absolute mobile associations [--outdir dir]` emits the same files once per configured host for deployment systems that publish static well-known files separately; `absolute mobile associations --verify` fetches every configured HTTPS endpoint without following redirects and verifies its content type and exact signing identity.
- Offline application data is configured through top-level Sync definitions and packs, not under `mobile`. `shell.offlineFallback` is presentation for a page that cannot be satisfied; it is not a data-sync policy.
- Only expose `nativeProject.mode: 'source'` in v1. Add `managed` or `external` after their respective lifecycle contracts and tests ship.
- Reserve `webDir`, `server.url`, `server.cleartext`, and `server.allowNavigation` for the orchestrator. Provide an explicitly named experimental escape hatch only after threat review.
- Resolve directories relative to the config/service `cwd`, matching workspace behavior.
- Support mobile config inside an Absolute workspace service. Command services cannot be mobile targets.
- Keep secrets out of config and exported HTML. Document public build-time environment variables separately.
- Do not add Expo fields until the v2 schema is implemented; the discriminated union merely reserves the design.

### Application code

```ts
import { camera, haptics, platform, share } from '@absolutejs/devices';

const capability = await camera.capability();
if (capability.available) {
  const permission = await camera.requestPermission(); // call from a click
  if (permission.state === 'granted') {
    const photo = await camera.capture({ source: 'prompt' });
  }
}

await haptics.impact('medium'); // supported native behavior or documented no-op
await share.open({ title: 'Product', url: location.href });
console.log(await platform.info());
```

No application code should import `@capacitor/*` merely to support normal device behavior. Raw Capacitor and Expo SDKs remain valid escape hatches for advanced cases.

## Mobile bundle and runtime pipeline

The dual response/page-envelope runtime is the highest-risk v1 work and should be implemented before CLI polish.

### Artifact contract

The final `webDir` must contain:

```text
index.html
offline.html                       # shell fallback when configured
assets/...                         # content-hashed page JS/CSS/images/fonts
pages/...                          # mobile render/hydration entries by page ID
absolute-mobile-manifest.json      # route patterns, pages, hashes, runtime versions
absolute-mobile-bootstrap.js       # lifecycle/deep-link/device setup
absolute-mobile-router.js          # envelope navigation/rendering runtime
```

It must not depend on the Bun server to start, show an offline/connection state, load embedded assets, or restore a cached page. Fresh server-dependent routes and mutations naturally require the deployed server.

### Bundle algorithm

1. Load and validate the selected workspace service and mobile config.
2. Build/import the configured server and capture its finalized Elysia 2 route
   table, composed with the official AOT capture.
3. Join the finalized runtime routes to build-injected Absolute page identities,
   TypeScript-derived prop contracts, framework page scans, SPA child-route
   analysis, conventions, and the asset manifest. Static analysis does not try to
   reimplement Elysia prefix/plugin composition.
4. Fail on duplicate/ambiguous route ownership or page handlers whose client identity cannot be resolved. Preserve server-only API routes without bundling them as pages.
5. Generate a mobile client-render entry for every reachable page identity. A framework is not stable until this path passes its runtime/version conformance suite. Generate restricted local HTML entries separately.
6. Bundle the local shell/router, request/auth/device adapters, all page entries, CSS, islands, and referenced public assets into isolated staging.
7. Generate the route/page/capability/runtime manifest. Dynamic route patterns remain patterns; the build does not enumerate their parameter values.
8. Optionally render only the configured entry/offline shell as non-user-specific bootstrap content. Do not snapshot every route or private props at build time.
9. Validate every embedded reference, route-to-page mapping, framework bootstrap, forbidden HMR/production server settings, and declared native capability.
10. Atomically promote staging to `bundleDirectory`; Capacitor sync then copies it into the native projects.

### Framework behavior

| Framework/style | v1 behavior | Important limitation |
| --- | --- | --- |
| React | Same route emits versioned props; embedded entry client-renders | Router ownership and old-binary prop compatibility need tests |
| Svelte | Same route emits versioned props; embedded entry client-renders | Compiler/runtime and component API are pinned in the bundle |
| Vue | Same route emits versioned props; embedded entry client-renders | SPA history/base paths need local-origin tests |
| Angular | Same request context emits typed client bootstrap data | DI/router bootstrap and base href need a formal envelope contract |
| Ember | Same route result boots the embedded client runtime | Bundle size/startup needs a performance gate |
| HTML | Audited static HTML/scripts are embedded; dynamic markup is sanitized | Arbitrary downloaded scripts/event handlers are unsupported |
| HTMX | Embedded audited shell accepts sanitized fragments through an Absolute HTMX extension | History, swaps, CSRF, auth and URL policy are extension-owned |
| Islands | Embedded island entries render from versioned per-request data | Server-only island data is not a build snapshot |
| Cross-framework navigation | Begin with a hard document/runtime reset for every page-root transition | Same-framework optimized transitions are a later measured feature |

### Data and network model

- Route props/results are produced per request by the deployed server, so authenticated/dynamic pages retain normal freshness while executable UI remains the audited embedded bundle.
- The shell fetches page envelopes with the native auth transport and can apply ETag/cache policy. Private envelopes must use user/session-partitioned encrypted storage or no persistent cache.
- `@absolutejs/http`, Auth, Sync and the Absolute HTMX extension resolve canonical backend URLs and attach credentials only for the configured destination. A canonical URL API also owns share URLs, analytics URLs and external deep links; raw `location.href` is never the public URL contract.
- Doctor/lint detects relative fetch/XHR, raw forms, WebSocket/EventSource, workers and origin-derived asset URLs. Build-time compatibility rewrites may improve coverage, but raw browser behavior is never the security contract and a global monkey patch is not the product foundation.
- Browser WebSocket cannot attach an arbitrary Authorization header. Sync must add a versioned authentication handshake using a DPoP-bound proof or short-lived single-use socket ticket with strict issuer, audience, origin, expiry and replay validation. Long-lived tokens never appear in URLs.
- The backend must allow the app's platform origins and intentional custom scheme/origin. Reuse the planned AbsoluteJS CSRF allowed-origin work rather than disabling CSRF globally.
- Mobile API/page requests use the mobile `@absolutejs/auth` transport described below. They do not depend on sharing WebView cookies with the system browser.
- Every network-backed surface must define loading, offline, timeout, stale-data, and reauthentication behavior.
- The shell is always offline-safe. Data declared through `@absolutejs/sync` is
  local-first: cached reads and durable declarative writes continue offline and
  reconcile when the backend is reachable. Ordinary route envelopes and arbitrary
  network calls remain connected-first unless their author or owning sync pack
  declares how to materialize them locally.
- Page envelopes may carry an authorized Sync bootstrap/cursor only when the loader
  explicitly declares a registered collection projection. Arbitrary route props
  cannot be inferred to be durable Sync state.

### Navigation and deep links

The generated bootstrap should:

- Normalize custom schemes, Universal Links, and Android App Links into one URL object.
- Route known manifest patterns through the local shell and request their live envelope.
- Open unknown HTTPS origins in the system browser by default.
- Preserve query and fragment values.
- Integrate Android back with browser history, exiting only at the root when product policy allows.
- Consume launch URLs before initial navigation and subscribe to later `appUrlOpen` events.
- Handle Capacitor's restored plugin results after Android activity recreation.
- Expose lifecycle events through `@absolutejs/devices`.

Universal Links/App Links require hosted association files, entitlements/manifest entries, signing identifiers, and real-device tests. `absolute mobile doctor` should validate what it can and print deployment instructions for the rest.

## Universal authentication architecture

> Implementation status (August 2026): the Capacitor v1 baseline described in
> this section is implemented. A project that declares `@absolutejs/auth`
> automatically receives a deterministic public client derived from
> `mobile.appId`; no `mobile.auth` block is required. The generated shell uses
> the system browser, S256 PKCE, rotating refresh-token families with replay
> revocation, Keychain/AndroidKeyStore storage, and bearer page/API requests.
> Existing `createAuthClient()` calls select the scoped native transport through
> an explicitly installed package runtime registry. If the project also declares
> `@absolutejs/sync`, existing `createSyncClient({ url })` calls obtain a new
> hashed, audience-bound, single-use socket ticket for each connection and
> reconnect. Explicit application transports always take precedence; web and
> server runtimes do not install either registry.

Authentication is a required v1 workstream, not an application-level workaround.
Repository inspection shows that `@absolutejs/auth` currently provides a good
framework-neutral client, but defaults it to same-origin fetch and protects most
human routes with an HTTP-only `user_session_id` cookie. That remains the correct
browser model. Installed apps need a different transport behind the same client.

Native OAuth best practice requires an external user agent and Authorization Code
with PKCE; installed apps are public clients and cannot safely contain a client
secret ([RFC 8252](https://www.rfc-editor.org/info/rfc8252/)). Current OAuth security
guidance requires PKCE for public clients and requires public-client refresh tokens
to be sender-constrained or rotated with reuse detection
([RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html)).

### One application auth API, two transports

```text
Application code
  auth.signIn({ provider: 'google' })
  auth.status()
  auth.fetch('/api/account')
  auth.signOut()
                         |
             @absolutejs/auth/client
                         |
           +-------------+----------------+
           |                              |
 WEB TRANSPORT                       MOBILE TRANSPORT
 same-origin request                 discover Absolute Auth OIDC metadata
 HTTP-only session cookie            generate state + verifier/challenge
 browser redirect/popup              open system auth browser
 CSRF cookie/origin rules            claimed HTTPS/app-link callback
           |                         exchange code + verifier
           |                         short access token
           |                         rotating/sender-bound refresh token
           |                         secure native credential storage
           +-------------+----------------+
                         |
                 ABSOLUTE AUTH SERVER
          canonical user, grants, sessions/devices,
          provider federation, MFA, revocation, audit
                         |
           +-------------+----------------+
           |                              |
 web protected route                 mobile page/API request
 resolves cookie                     validates audience/scope/token proof
           |                              |
           +------ normalized AuthPrincipal/AuthContext ------+
                         |
                 same route/data authorization
```

The system browser may show Absolute Auth's login/provider UI, but the credential
callback and long-lived session belong to the installed app. The app must not run
OAuth inside its main embedded WebView. Capacitor provides a system browser surface
and the App API delivers inbound links ([Browser plugin](https://capacitorjs.com/docs/apis/browser),
[deep-link guide](https://capacitorjs.com/docs/guides/deep-links)). Expo later uses
its AuthSession equivalent, whose PKCE behavior is already designed for this model
([Expo AuthSession](https://docs.expo.dev/versions/latest/sdk/auth-session/)).

### Implemented `@absolutejs/auth` foundation and remaining hardening

The inspected Auth server already supplies the difficult standards substrate:
mandatory PKCE, public clients, single-use authorization codes, rotating refresh
tokens, discovery, logout, optional DPoP/nonce, dynamic registration, device flow,
PAR/JAR and FAPI support. Mobile work should not fork or rebuild that server. It is
an installed-app client, provisioning, principal-normalization and lifecycle project.

- Add a runtime-selected auth transport contract. Preserve `createAuthClient` and
  framework hooks/composables; callers should not branch on platform.
- Register each installed app as a public OAuth/OIDC client with exact redirect
  URIs, allowed scopes, audiences, platform/application identity, and no secret.
- Use Absolute Auth's authorization/token/discovery capabilities as the app-facing
  authorization server. Upstream Google/GitHub/enterprise federation remains a
  server concern and does not expose provider secrets to the app.
- Add a Capacitor client adapter that owns discovery, state, S256 PKCE, browser
  launch/cancel, deep-link validation, code exchange, refresh coordination, and
  logout/revocation.
- Add secure credential storage as an auth dependency contract. The Capacitor
  adapter supplies Keychain/Keystore-backed storage; normal Preferences/localStorage
  is not sufficient for refresh credentials.
- Use short-lived, audience- and scope-restricted access tokens. Implement rotating
  refresh tokens with replay-family revocation before release; evaluate DPoP as the
  stronger device-bound option rather than pretending secure storage makes bearer
  tokens unextractable.
- Replace cookie-only protection internals with a normalized `AuthPrincipal` source
  that can be established from a valid web session cookie or a mobile access token.
  Existing cookie routes keep working. Route/business code reads the same principal.
- Apply that principal to page-envelope requests, Absolute HTTP/HTMX/uploads and
  server actions. Add a Sync/socket authentication frame or short-lived one-time
  ticket because standard browser WebSocket cannot attach the bearer header used
  by HTTP. Never place long-lived access/refresh tokens in page props, HTML, query
  strings, logs, URLs, or the route manifest.
- Serialize refreshes so concurrent page/API requests cannot rotate the same token
  twice. Define clock skew, offline expiry, background/resume refresh, revocation,
  password-change, device-loss, and account-switch semantics.
- Model each installed app session/device in session management so users can view
  and revoke it independently. Do not pretend a mobile token grant is the same
  browser-cookie instance.
- Make sign-out revoke the native grant/refresh family, clear secure storage and
  page caches, and optionally end the system-browser SSO session according to an
  explicit product choice.
- Add native-safe flows for email verification, magic links, password reset, MFA,
  passkeys, and account linking. Links must resume the exact pending transaction and
  reject mismatched state/issuer/client/redirect.
- Keep client secrets and upstream provider token exchange entirely server-side.

### Zero-code-change boundary

Normal users should not rewrite recognized routes, auth hooks, login buttons, or
calls already made through Absolute-owned HTTP/Sync/HTMX APIs. There is one honest
boundary: raw relative fetch/XHR/forms/socket code, direct cookie parsing, assumptions
that `window.location` is the deployed HTTPS origin, manually constructed provider
OAuth URLs, and browser credential storage are origin- or platform-specific. Doctor/
lint rules should identify those patterns and point to the universal API; silently
emulating unsafe cookie behavior would undermine the model.

### Auth acceptance criteria

- The same sign-in UI action works on web, Capacitor iOS, Capacitor Android, and the
  mobile browser preview without application branching.
- A browser gets an HTTP-only cookie and no mobile refresh credential.
- A native app gets no embedded client secret and does not depend on system-browser
  cookies after the code exchange.
- Page envelopes and APIs resolve the same user/organization/roles/scopes from
  either credential source.
- Sync/WebSocket authentication uses a replay-resistant proof or one-time ticket,
  never a refresh token or durable bearer credential in the URL.
- Deep-link interception, code injection, state mismatch, redirect mismatch,
  refresh replay, revoked device, offline expiry, and concurrent refresh have tests.

## `@absolutejs/devices` design

### Package boundaries

Recommended packages:

- `@absolutejs/devices`: contracts, normalized types/errors, web and SSR adapters, test adapter, and public feature entry points.
- `@absolutejs/devices-capacitor`: Capacitor adapter and narrowly scoped optional plugin integrations.
- `@absolutejs/devices-expo`: Expo/React Native adapter plus bounded WebView bridge, published independently from Capacitor.

If release management favors a monorepo, these may be workspaces in `~/abs/devices`; they should still publish separately so Capacitor dependencies never enter the web/Expo bundle and Expo dependencies never enter the Capacitor bundle.

### Adapter selection

Use build-time aliasing/injection:

```text
normal web build  -> @absolutejs/devices/runtime -> web adapter
server build      -> @absolutejs/devices/runtime -> SSR adapter
Capacitor bundle  -> @absolutejs/devices/runtime -> Capacitor adapter
Expo build        -> @absolutejs/devices/runtime -> Expo adapter
tests             -> explicit in-memory test adapter
```

Do not depend only on package `browser` conditions: browser bundles and Capacitor WebViews both select browser code. Do not eagerly import every provider and detect at runtime: that bloats bundles and can make React Native/native packages impossible to bundle for the web.

Allow explicit dependency injection for tests and advanced shells, but keep the normal API import-only.

### Contract principles

- Organize by user capability, not vendor plugin name.
- Keep feature subpaths tree-shakeable and native dependencies optional.
- Normalize values, units, timestamps, listener cleanup, and errors.
- Preserve platform-specific data under an optional `native` field only when genuinely useful.
- Distinguish `unsupported`, `unavailable`, `permission-denied`, `permission-blocked`, `cancelled`, `temporarily-unavailable`, and `failed`.
- Return capability information; do not make apps infer behavior from `ios`/`android` strings.
- Never request a sensitive permission during module import, application boot, or capability query.
- Make listener functions return a synchronous or awaitable `unsubscribe`, normalized across adapters.
- SSR imports must be safe. Querying capability on SSR returns unavailable; invoking UI/device actions returns a typed error.
- No-op only for effects where absence is naturally harmless, such as haptics. Never silently no-op camera, location, files, or secure storage.
- Expose raw provider access from adapter-specific packages, not the core contract.

### Capability waves

Wave 0, needed by the shell:

- `platform`: runtime, OS, form factor, locale, app version/build, safe-area and reduced-motion signals.
- `lifecycle`: active/background/resume and restored operation results.
- `links`: launch URL, inbound URL listener, open external URL.
- `network`: connected state and changes.
- `storage`: ordinary key/value persistence with a clearly separate secure-storage contract.

Wave 1, high-value cross-platform APIs:

- camera/photo picker
- geolocation/watch
- share sheet
- clipboard
- haptics
- file open/save/pick
- local notifications
- push notification registration/token/events
- keyboard and system/status bar controls

Clipboard, share sheet, haptics, camera capture, scoped photo selection,
Documents, foreground location/current/watch, and one-time Local Notifications
are the completed Wave 1 foundation. They
ship in `@absolutejs/devices@0.5.0` with
web/SSR/test behavior and isolated Capacitor provider entries in
`@absolutejs/devices-capacitor@0.6.1`. AbsoluteJS discovers
named value imports with its TypeScript AST, ignores type-only/test imports,
validates declarative provider metadata, installs exact tested plugins only after
approval, generates adapter wiring, records the effective graph in the mobile
manifest, and checks it in the release doctor. The base adapter has a distribution
gate proving it does not import the optional plugins. Automatic removal remains
explicit because a dependency may be consumed outside the discoverable app graph.
Camera permission is an explicit application action; capture never prompts
implicitly. Photo selection uses the OS item-scoped picker, omits EXIF, and does
not require broad library access. The provider metadata also declares native
permission purposes, which AbsoluteJS projects into owned iOS Info.plist entries
and validates in the release doctor without adding unnecessary Android
camera/storage permissions.
Location follows the same explicit-permission boundary, normalizes coarse versus
precise access and provider errors, and returns idempotent watch cleanup. Its
declarative provider metadata installs Geolocation 8.2.2 and projects Android
coarse/fine permissions plus the provider-required iOS usage descriptions.
This contract is foreground-only; background tracking remains a separate future
privacy, battery, native-lifecycle, and store-review design.

Wave 2, after focused design:

- biometrics
- contacts/calendar
- background work
- motion/orientation
- in-app browser and OAuth sessions
- health/fitness
- maps
- purchases

Contacts, health, background location, and other restricted data should be separate opt-in packages or plugins. In particular, broad permission installation cannot be an accidental side effect of importing the base package.

### Web fallbacks

Use the best standards-based web API when available: Page Visibility, Network Information with `navigator.onLine` fallback, Web Share, Clipboard, Geolocation, file inputs/File System Access where supported, Notifications, Screen Orientation, and matchMedia signals.

Fallback behavior must be capability-based. For example, camera capture can fall back to a file input with `accept="image/*"` and capture hints, but callers must be able to see that direct camera controls are unavailable.

### Permissions

Use one normalized state model:

```ts
type PermissionState =
  | 'prompt'
  | 'granted'
  | 'denied'
  | 'blocked'
  | 'limited'
  | 'unavailable';
```

Each capability owns its permissions because native platforms split them differently. `absolute mobile doctor` and bundle should compare configured/imported capabilities with native permission descriptions and fail before release when required declarations are absent.

## CLI and core implementation areas

Expected AbsoluteJS changes:

- `types/build.ts`: mobile discriminated config and safe Capacitor override types.
- `src/utils/loadConfig.ts`: reserve `mobile` as a single-service key.
- `src/core/mobile/`: config normalization, route-manifest capture, page-result/envelope protocol, local router, request transport, bundle manifest, validation, and bootstrap generation.
- `src/build/`: build-target alias plugin for device adapters and target-specific dead-code definitions.
- `src/cli/scripts/mobile.ts` plus small focused modules: init/bundle/dev/sync/run/open/build/doctor.
- page handlers and response finalization: framework-neutral page results with browser/mobile representations.
- dev build/watcher/banner: browser and mobile targets from one graph, mobile preview, device connection status.
- AbsoluteJS Elysia integration: finalized route capture, representation negotiation, normalized auth/request context.
- `@absolutejs/auth`: web/mobile transports, public native clients, PKCE, secure token lifecycle, bearer/DPoP principal resolution.
- `@absolutejs/sync`: durable operation identity/server dedupe, restart-safe declarative optimistic operations, multiplexed-client persistence, typed conflict outcomes, headless push/pull, SSR/envelope bootstrap, account partitioning, and offline observability.
- `sync-adapters`: IndexedDB/web lifecycle plus Capacitor SQLite/App/Network/Background Runner adapters; later Expo SQLite/AppState/background-task adapter. Keep runtime dependencies target-isolated.
- `@absolutejs/pwa`: optional service-worker bridge that invokes Sync headless flush when Background Sync is available; retain its current shell/static-asset/push boundary.
- `sync-packs`: additive local materialization, serializable operation, sensitivity/encryption, retention, conflict, and background-policy metadata with conformance tests.
- `src/cli/index.ts`: lazy mobile command dispatch and help.
- `src/cli/scripts/doctor.ts`: shared prerequisite checks.
- `src/cli/config/`: mobile schema/config UI support, with secret-free fields only.
- `scripts/build.ts` and `package.json`: publish new runtime/bootstrap files and types.
- telemetry: command names, provider, platform, duration, and success/failure only; never app IDs, URLs, routes, signing data, or device identifiers.
- `create-absolutejs`: optional mobile setup only after the standalone `mobile init` UX is stable.
- documentation/examples: a multi-framework demo that navigates between at least three frameworks and uses device APIs.

Do not stretch `static.routes` into the mobile architecture. Server prerender is a route-output cache. The mobile bundle contains the local shell and executable page assets, while live route results come from the normal server through the envelope protocol.

## Native project ownership

Capacitor creates real platform projects when `cap add ios` or `cap add android`
runs. The iOS directory is an Xcode project and the Android directory is a Gradle
project. They contain the native application shell, bundle/package identifiers,
signing and build settings, icons/splash assets, entitlements, privacy/permission
declarations, deep-link association, installed plugin wiring, and any Swift/Kotlin
customizations.

They are **generated initially from the existing AbsoluteJS configuration and
mobile bundle**, but they are not equivalent to `node_modules` after creation.
`cap sync` repeatedly copies the latest web bundle and updates native plugin
dependencies without recreating the whole projects. A developer may later enable
push notification capabilities in Xcode, adjust an Android manifest, add a native
plugin, or change signing. Deleting and regenerating the directories could lose
those changes.

### Capacitor native-project options

There are four viable ownership models. They affect native configuration and
upgrades, not whether AbsoluteJS routes are write-once.

| Mode | Source of truth | Advantages | Costs / failure modes | Recommendation |
| --- | --- | --- | --- | --- |
| `source` | `mobile/ios` and `mobile/android` are committed application source after `mobile init` | Matches Capacitor's normal workflow; complete Swift/Kotlin and native-SDK escape hatch; reviewable diffs; deterministic local/CI builds; signing, entitlements, plugins, and emergency fixes are never hidden | Native files add repository weight and upgrade diffs; developers eventually need Xcode/Gradle knowledge; configuration can drift if automation is weak | **Default for v1** |
| `managed` | `absolute.config.ts`, installed capability manifests, assets, and deterministic native transforms; platform directories are disposable build output | Clean web-first repository; easiest beginner story; reproducible regeneration and fleet/white-label builds; upgrades can replace the template | AbsoluteJS must build and maintain an Expo-CNG-like transform/plugin ecosystem; every entitlement, Gradle/Plist edit, native dependency, signing rule, and third-party plugin must be reproducible; manual native edits are lost; Capacitor itself does not supply this complete ownership model | Experimental only after regeneration parity and round-trip tests |
| `external` | A separate native repository/workspace owns the projects and consumes a versioned AbsoluteJS mobile bundle/config manifest | Strong mobile/web team separation; one wrapper can consume several web releases; useful for regulated release pipelines and existing brownfield apps | Coordinated versions and two-repo debugging; slower local DX; bundle/native capability mismatch risk; more CI/artifact infrastructure | Supported escape hatch, not starter default |
| `source` with generated regions | Committed native projects plus declarative, structurally edited AbsoluteJS-owned fields | Preserves full native control while automating IDs, icons, deep links, permission text, plugin wiring, build numbers, and background capabilities; closest path to managed DX without pretending projects are disposable | Requires ownership markers, structural AST/project edits, drift detection, dry runs, and conflict handling | **Implementation strategy inside the v1 default** |

The [official Capacitor workflow](https://capacitorjs.com/docs/basics/workflow)
builds the web bundle, runs `cap sync` to copy it and update native dependencies,
and then opens/builds the real Xcode or Gradle project. Capacitor also documents
[typed structural project tooling](https://capacitorjs.com/docs/guides/automated-configuration)
for automated configuration. AbsoluteJS should use that structural layer for
generated regions rather than string replacement, while leaving the rest of the
project under user ownership.

Recommended public shape once more than one mode is actually supported:

```ts
mobile: {
  engine: 'capacitor',
  nativeProject: {
    mode: 'source',       // v1 default and only stable v1 mode
    directory: 'mobile'
  }
}
```

Do not expose a `managed` enum merely to reserve it. First prove that a project
using native auth redirects, push, universal links, Background Runner, secure
storage, custom icons, and one custom Swift/Kotlin plugin can be deleted and
regenerated byte-for-byte apart from documented volatile files. Until that gate
passes, calling native projects disposable would create a data-loss trap.

Therefore, for Capacitor v1:

- Default to `mobile/ios` and `mobile/android` as committed source.
- `absolute mobile init` generates them automatically; most developers should not
  need to understand their contents on day one.
- Normal changes to pages/routes/data only rebuild the shared mobile bundle and
  sync it. They do not regenerate native projects.
- AbsoluteJS should own and structurally maintain the predictable portions—app
  IDs/names, assets, permissions derived from installed device capabilities,
  deep-link entries, and generated bootstrap/plugin configuration—while preserving
  native edits outside those owned regions.
- Generated files must contain provenance comments and be updated structurally.
- `mobile init` owns first creation only. Later commands use `cap sync`, which is designed to update web assets/dependencies without replacing the project.
- Detect manual changes before any operation that might replace a generated file.
- Never offer a blanket `--force` that deletes native projects. A targeted regeneration command would require a backup and explicit platform path.
- Document Swift Package Manager/CocoaPods and Gradle extension points.
- Pin Capacitor core, CLI, platforms, and official plugins to the same compatible major/minor policy; validate alignment in doctor and release gates.

If the product later requires fully disposable Capacitor projects, AbsoluteJS
would need an Expo-CNG-like native configuration/plugin system capable of expressing
every customization reproducibly. That is a major feature of its own and is not
required for the write-once route/UI model.

Expo v2 should use CNG by default and ignore generated native directories, which is another reason not to force both engines through one native-project manager.

## Security, privacy, and compliance gates

The implemented baseline threat model covers:

- local WebView origins, navigation allowlists, and external URL handling
- API CORS and CSRF from iOS/Android origins
- token storage, refresh, logout, and device compromise
- OAuth redirect/deep-link validation and PKCE
- page-envelope, cache, props, and embedded bootstrap inspection for secrets and unsafe user-specific persistence
- CSP compatible with Capacitor injection and local assets
- plugin supply chain and native dependency review
- remote content and update integrity
- WebView debugging/logging disabled in release builds
- certificate/transport security and no production cleartext
- file URL conversion and path traversal
- push token and device identifier treatment
- iOS privacy manifests/usage descriptions and Google Play data-safety declarations
- permission minimization and removal when capabilities are unused

Release doctor fails on production `server.url`, cleartext, wildcard navigation,
HMR scripts, missing permission/privacy projection, incompatible native/runtime
manifest versions, modified or unresolved local assets, dependency drift, unsafe
debug settings, mismatched native links, or an HTTP API origin. Android exported
components require explicit warning review. Store questionnaires, final-binary
signing inspection, native-SDK data practices, and physical devices remain human
gates.

## Testing strategy

### Unit tests

- config parsing, defaults, reserved fields, workspace service projection
- runtime route capture, handler/page mapping, and dynamic-pattern matching
- page-result to browser HTML/mobile envelope finalization
- envelope schema/versioning, safe head projection, restricted-markup sanitization,
  cache partitioning and hard runtime resets
- canonical URL/request resolution, credential destination allowlisting and raw-
  browser-API diagnostics
- bundle/route manifest determinism and hashing
- web-cookie and native-PKCE auth transport conformance
- token refresh rotation/replay/concurrency and secure-storage failure behavior
- device contract conformance for web, SSR, test, and Capacitor adapters
- permission/error normalization
- deep-link parsing and back-stack decisions
- CLI argument parsing and command construction
- secret/live-reload release checks

### Integration tests

- execute unchanged routes and obtain an envelope for every supported framework plus islands
- run installed binary N against compatible and incompatible N+1/N+2 servers;
  render correctly or show typed upgrade UI, never hydrate mismatched code
- reject malicious scripts, handlers, base/meta redirects, hostile forms, forged/
  oversized bridge messages and credential/origin confusion
- navigate cross-framework through the local router and embedded page assets
- SPA child routes and hard reloads
- dynamic parameters, request-time authenticated props, redirects, errors, and not-found conventions
- Absolute HTTP/Auth/Sync/HTMX/upload against the configured server; raw fetch,
  form, socket and EventSource cases produce their documented support/diagnostics
- CSS preprocessors, public assets, optimized images, fonts, modulepreload, source maps
- dynamic-route examples, redirects, 404, offline fallback
- workspace service config and non-default cwd/build directory
- live reload config lifecycle, including cleanup on SIGINT/crash
- native dependency add/remove followed by sync

### Native end-to-end matrix

Minimum CI/release matrix:

- latest stable and oldest supported iOS simulator runtime
- latest stable and oldest supported Android API/WebView combination
- one physical iOS device and one physical Android device before release
- debug/live reload and signed release builds
- cold start offline, background/resume, process death/restoration
- repeated cross-framework A→B→A hard resets with bounded memory, listeners, timers,
  focus, scroll, forms and native-plugin calls
- deep links from terminated/background/foreground states
- keyboard, safe areas, rotation, dark mode, large text, reduced motion
- camera/location permission grant, denial, block, later settings change
- network transitions and expired authentication
- upgrade from the previous published app/runtime version
	- Android automated gate: `bun run test:native:android:upgrade`; inspect
	  `.absolutejs/mobile-native-conformance/embedded-artifacts/android-upgrade-conformance.json`
	  for sanitized package/version and timing evidence
	- require stable UID, data directory, and first-install time across APK replacement
	- require Auth restore, Sync SQLite restore, and pending-outbox restore after relaunch
	- require N+1/N+2 compatibility, typed N+3 update-required, and rollback recovery
	- separately advance the generated Sync schema and prove transactional migration

Use Playwright for the mobile browser-preview/envelope runtime, then a native automation layer such as Maestro or Detox after a spike. Do not choose the native runner until it proves reliable with Capacitor WebViews and permission dialogs.

### Performance budgets

Measure per framework and on low/mid-tier Android hardware:

- native binary size contribution
- embedded mobile bundle size per page/framework
- cold start to first painted shell
- cold start to interactive
- cross-framework navigation latency
- memory after repeated navigation
- WebView reload/process-recovery behavior

Set budgets from the prototype baseline rather than inventing numbers now. Fail regressions in CI once baselines are accepted.

## Observability and debugging

- Forward AbsoluteJS browser errors with engine/platform/app-build/mobile-manifest metadata, excluding device identifiers by default.
- Symbolicate mobile web bundles using the existing private sourcemap direction.
- Preserve console/HMR overlay behavior during live reload.
- `absolute mobile inspect` prints the redacted effective config,
  runtime/provider versions, native plugin list, route/framework summary,
  origins, native-project state, release projection, and embedded-bundle
  validation in human or JSON form.
- Capture native crash reports through platform-native tooling; web error reporting is not a substitute.
- Log lifecycle, deep-link, permission, and adapter failures behind an opt-in debug namespace.

## Expo v2 architecture

### Why Expo exists alongside Capacitor

Capacitor produces a genuine installable native application project and gives it
native lifecycle, packaging, permissions, plugins, and SDK access. Its main
application UI, however, is rendered by WKWebView on iOS and Android WebView on
Android using HTML/CSS/DOM. “Native app via Capacitor” is accurate at the binary,
container, integration, and device-API layers; it does not mean that a `<button>`
becomes a UIKit or Jetpack Compose button.

Expo/React Native renders a React component tree through native rendering primitives
and native navigation. That is valuable for screens whose requirements are dominated
by native UI behavior: very large virtualized lists, gesture-heavy transitions,
native navigation stacks/tabs, platform widgets, highly integrated maps/camera,
or advanced React Native/Expo-only libraries. The tradeoff is exactly the one in
the product feedback: native-rendered routes are React-only and must be authored
with React Native-compatible primitives. Existing React DOM, Vue, Svelte, Angular,
Ember, HTML, and HTMX pages do not automatically become React Native views.

Expo is therefore an expert rendering option, not the mechanism that makes normal
AbsoluteJS apps mobile. Capacitor remains the default all-framework path. Expo may
be selected for an all-React-native application or, later, for explicitly replaced
native React routes inside a hybrid shell.

### Recommended model

Build an Expo application shell rather than installing Expo into the Capacitor native projects:

```text
Expo Router (source of native navigation)
  |
  +-- native route -> React Native / Expo component
  |
  +-- web route ----> generated WebView host
                           |
                           +-- AbsoluteJS page envelope + embedded page assets
                           +-- navigation bridge
                           +-- device-action bridge
                           +-- auth/session bridge
                           +-- native-owned Sync store/socket bridge
```

This preserves all-framework compatibility for web-rendered routes while permitting selected React Native screens. It does not claim that the non-React routes use native UI controls.

### Proposed v2 config direction

```ts
mobile: {
  engine: 'expo',
  appId: 'com.example.product',
  appName: 'Product',
  routes: {
    default: 'web',
    native: {
      '/scanner': './mobile/native/scanner.tsx',
      '/map': './mobile/native/map.tsx',
      '/products/:productId': './mobile/native/product.tsx',
      '/files/*': './mobile/native/files.tsx'
    }
  },
  expo: {
    // Safe Expo app-config overrides and config plugins
  }
}
```

Do not use a free-form per-page `renderer: 'expo'` export as the first design. Routes are registered in the server entry, native routes must be statically known to Expo Router, and the same page can be mounted at multiple URLs. A route-to-module map is unambiguous and code-generatable. Automatic conventions such as `Account.native.tsx` can be layered on later for React routes, but should compile down to the same manifest.

Later, add colocated metadata only if the AbsoluteJS route manifest becomes the canonical typed routing layer:

```ts
mobile: {
  renderer: 'native',
  module: './mobile/native/scanner.tsx'
}
```

### Bridge requirements

The Expo WebView host must define versioned messages for:

- ready/handshake and capability negotiation
- push/replace/back/dismiss navigation
- current URL and deep-link delivery
- request/response device actions with cancellation and timeouts
- lifecycle and network events
- auth token/session changes without exposing long-lived secrets to page storage
- atomic Sync transactions, native socket frames, and lifecycle wake events
- theme, locale, safe-area, and accessibility settings
- structured errors and telemetry correlation

Every message needs schema validation, allowed-origin/source validation, a request ID, version, maximum size, and explicit method allowlist. Arbitrary JavaScript evaluation is not an API.

`@absolutejs/devices` in a web route would use a bridge adapter; native routes would use the Expo adapter directly. The two adapters must pass the same conformance suite.

### State and navigation rules

- Expo Router owns the top-level back stack and deep links.
- A WebView reports internal navigation. The shell decides whether back is handled inside the web history or by Expo Router.
- Native and web engines do not share in-memory global state. Shared durable state goes through a typed bridge/store or backend.
- Each transition defines URL ownership so the same path cannot be simultaneously claimed by a native and web route.
- Native route modules are React Native only. React DOM is still a web route unless explicitly migrated.
- Native layouts cannot be DOM components; Expo documentation requires native layout routes.

### Expo milestones

1. R&D spike: one Expo Router shell, one native React screen, one envelope-rendered AbsoluteJS web page, back/deep link, and one bridged device call.
2. Formalize bridge protocol and conformance tests.
3. Add Expo config generation, CNG config plugin, dev-client workflow, and EAS-optional builds.
4. Add route code generation and conflict validation. **Operational:** static,
   named-parameter, and terminal-wildcard ownership generate deterministic Expo
   Router wrappers and reject ambiguous or reserved patterns.
5. Add auth/state/theme/accessibility bridges.
6. Test WebView lifecycle, memory, process death, OTA compatibility, and store review posture.
7. Mark experimental only after the all-framework demo works; stable only after production upgrade/rollback tests.

## Phased execution plan

### Phase 0: product decisions and feasibility spikes

Do not combine all unknowns into one prototype. Run these sequential kill-gated
spikes and amend the architecture after each:

1. **Representation/version spike:** one framework, data-only envelope, embedded
   client render, old binary N against servers N+1 and N+2, plus controlled
   `upgrade-required`. Generate and retain the matching N/N+1/N+2 server
   compatibility artifacts without changing route/page source. Reject the
   architecture if server deployment can cause mismatched executable UI or an
   unexplained blank page.
2. **Real-app identity/transport spike:** one Capacitor app on iOS and Android,
   local assets, canonical URLs, public-client PKCE auth, deep link, page/API call,
   and authenticated Sync socket proof/ticket. Reject any design that puts durable
   credentials in URLs or depends on system-browser cookies inside the WebView.
3. **Hostile-content spike:** attack envelopes and the native bridge with scripts,
   event handlers, `<base>`, meta refresh, hostile forms, oversized messages,
   forged responses and origin confusion. Remote content must not call a native
   capability or read credentials outside its allowlisted contract.
4. **Second-framework/lifetime spike:** add another framework and use hard runtime
   resets while testing repeated A→B→A navigation, listeners, global CSS, portals,
   timers, focus, scroll, forms and plugin calls. Establish memory/startup budgets
   before expanding the framework matrix.
5. **Independent Sync v3 spike:** one collection on IndexedDB and SQLite, crash at
   every local/send/server/ack boundary, switch accounts, lose an ack and prove no
   duplicate external effect or cross-principal data. This track does not block a
   connected-first Capacitor alpha.
6. **Only after the gates pass:** expand conformance one framework at a time, prove
   restricted HTML/HTMX policy, build the mobile preview/dev graph, and then design
   the public CLI around measured behavior.

Across the spikes, route declarations remain unchanged for instrumented page
handlers. Opaque behavior must be classified. Record binary size, startup, memory,
network compatibility and every required migration in the published support matrix.

### Phase 1: canonical routes, page protocol, and mobile bundle

Implementation checkpoint (August 24, 2026): the production Capacitor
compatibility path now discovers unchanged Elysia routes backed by React, Vue,
Svelte, and Angular page handlers. The generated native shell embeds each
framework's client-render entry, supplies the same typed route props as the web
handler, waits for framework startup, and invokes a common disposal contract
before a cross-framework document reset. Production finalization preserves
custom `--config` resolution without starting the bundled application's network
listener. Content-addressed page JavaScript and generated CSS are signed into the
compatibility artifact; referenced `assets/` and `indexes/` files are copied into
the local Capacitor bundle.

The real multi-framework example now passes `absolute prepare` and produces one
local manifest containing Angular, HTML, HTMX, React, Svelte, and Vue routes and
bundles.
Real Android API 36 acceptance now installs that production bundle into an actual
Capacitor APK with no `server.url`, boots from embedded assets, and traverses
React, Angular, Vue, Svelte, HTML, HTMX, and back to React through ordinary links.
The same gate proves repeat execution of content-addressed HTML modules and HTMX
requests against the configured backend, including an origin-locked CORS bridge
and sanitization of downloaded scripts, handlers, privileged elements, and
cross-origin actions. Angular's production client entry derives and creates its
compiled host selector automatically. Recursive syntax-aware dependency copying
includes split framework chunks without treating strings as imports. Embedded
asset changes invalidate the native APK fingerprint; unchanged launches preserve
the fast native cache path. Android launches force-stop the old Activity first so
cached relaunches cannot restore a stale WebView document.
Focused conformance covers generated client mount/dispose behavior, repeated
A→B→A framework disposal, finalized Elysia route capture, styles, dependency
copying, and rejection of unsupported Ember pages. HTML and HTMX routes retain
their normal authoring model: their production documents and scripts are hashed
and embedded, root-relative HTMX requests are targeted at `productionOrigin`, and
network fragments lose scripts, active event handlers, privileged elements, and
cross-origin action URLs before HTMX swaps them. This trust policy belongs to
AbsoluteJS rather than application code. Ember mobile work is explicitly deferred
to the adapter milestones in `EMBER_PLAN.md`.

Deliverables:

- Typed config and normalization.
- Finalized Elysia route capture plus route-to-page/framework/asset manifest.
- Framework-neutral `AbsolutePageResult` and versioned browser/mobile finalizers.
- Mobile release artifact format, generated prop-schema fingerprints, current-plus-
  two compatibility retention, and request dispatch to the matching archived
  server data producer.
- Local router/renderer with navigation, dynamic routes, redirects, errors, caching policy, and cross-framework disposal/reset.
- Isolated mobile shell/page/device-adapter bundle, manifest, validation, and atomic output.
- `@absolutejs/http`, canonical URL/runtime transport, Sync socket authentication,
  maintained HTMX integration and diagnostics for raw origin-sensitive web APIs.
- `absolute mobile bundle`.
- Unit/integration tests across every framework.

Exit criteria:

- Deterministic repeated bundles and route manifests.
- Old mobile builds continue through generated retained producers; removing an
  artifact or incompatible database contract is a release-blocking diagnostic.
- Every recognized Absolute page route appears automatically; no config route list
  exists. Opaque routes fail release unless explicitly classified.
- Cross-framework demo obtains live request-time props from the same deployed server route handlers.
- Local shell/offline state and embedded assets run with no Bun server; fresh dynamic pages clearly require/recover connectivity.
- Existing `absolute build/start/compile` behavior is unchanged.

### Phase 2: universal Absolute Auth

Deliverables:

- Runtime-selected `@absolutejs/auth` web/mobile transport contract.
- Public native client registration/configuration and discovery.
- Capacitor system-browser Authorization Code + S256 PKCE adapter.
- Keychain/Keystore credential storage contract and implementation.
- Short access tokens plus rotating refresh-token families/reuse detection; DPoP decision/spike.
- Cookie-or-token normalized `AuthPrincipal` for pages and APIs.
- Lifecycle-safe refresh, device sessions/revocation, deep links, MFA/magic-link/reset/linking continuation, and logout.
- Security and conformance tests derived from RFC 8252/RFC 9700.

Exit criteria:

- Application auth calls and protected route code do not branch on platform.
- Web sessions remain HTTP-only cookie sessions.
- Native apps contain no client/provider secret and survive background, restart, token refresh, and revocation safely.
- The same user/organization/authorization result reaches the same Elysia route through either credential source.

### Phase 2A: shared local-first Sync profile

This can proceed alongside universal auth, but it cannot stabilize until auth
defines principal/tenant partition keys and logout/revocation behavior.

Deliverables:

- Durable string operation IDs scoped to an installation plus bounded server-side
  deduplication receipts/results.
- Transactional local outbox, confirmed materialized rows, cursors, operation
  status, and receipts behind one storage transaction contract.
- Declarative insert/update/delete operations with serializable optimistic and
  inverse/rebase semantics; an explicit process-local tier for arbitrary
  optimistic callbacks.
- Persistence for the multiplexed client so cross-collection atomic frames remain
  the recommended path.
- IndexedDB web adapter and SQLite Capacitor adapter, account/tenant namespaces,
  quota/eviction policy, migrations, logout purge/lock, and encryption hooks.
- Foreground, resume, connectivity, manual retry, and bounded headless HTTP
  push/pull orchestration. PWA Background Sync and Capacitor Background Runner are
  best-effort scheduling adapters over the same headless operation.
- Typed status/conflict/dead-letter APIs plus framework bindings and devtools.
- Route/page-envelope Sync bootstrap with authorized rows and resume cursor.
- Sync-pack metadata for local materialization, operations, retention,
  sensitivity, conflicts, and background eligibility.

Exit criteria:

- Offline reads and writes survive browser reload and mobile process death.
- A server commit followed by a lost ack never applies a non-idempotent effect
  twice.
- Two devices editing concurrently converge according to the declared policy;
  unresolved conflicts are surfaced rather than silently overwritten.
- Logout, user switch, tenant switch, token expiry, and revoked-device flows cannot
  expose cached rows or replay an outbox under the wrong principal.
- A stale cursor catches up or replaces its snapshot correctly across server
  instances and a server restart.
- The system remains correct with all background scheduling disabled; resume/manual
  retry eventually syncs.
- The same pack test suite passes against IndexedDB and Capacitor SQLite adapters.

Implementation checkpoint (August 25, 2026): Phase 2A now has its additive
protocol and storage foundation in `@absolutejs/sync` 2.16.0. Mutate frames can
carry a stable string operation ID while retaining their legacy numeric
correlation ID. The engine's server-owned durable-mutation runner derives the
receipt namespace from authenticated context and gives a database adapter one
atomic boundary for table writes, the receipt, and the stored result. A lost ack
can therefore replay the committed result without executing the handler or
emitting its diff twice. Effects outside that database boundary must still use a
transactional outbox.

The client package now defines one principal-namespaced `SyncLocalStore`
transaction for installation identity, confirmed rows, cursor, and serializable
optimistic/inverse outbox records. Its in-memory reference adapter and conformance
tests prove atomic rollback, account isolation, readonly enforcement, and stable
installation-prefixed operation IDs. Existing numeric frames and current
`createSyncCollection` storage/cache options remain backward-compatible. This is
the foundation checkpoint, not completion of Phase 2A: the next slices are the
IndexedDB implementation and multiplexed-client integration, then Capacitor
SQLite, auth-driven namespace lifecycle, conflict/dead-letter state, and headless
orchestration.

Implementation checkpoint (August 25, 2026, second Phase 2A slice):
`@absolutejs/sync` 2.17.0 now implements the web/PWA side of that contract with
IndexedDB and wires it into the recommended multiplexed client as an additive
durable profile. Cached rows and cursors hydrate before subscription; one server
frame persists every affected collection in one local transaction; serialized
insert/update/delete optimism and its automatically captured inverse survive
process death; and the same installation-prefixed operation ID replays until the
server echoes that exact identity. Missing/mismatched operation identity fails
closed instead of silently accepting an acknowledgment from a legacy server.
Existing callback optimism remains the explicit process-local tier, and the
non-durable client path is unchanged. The same conformance suite passes against
the in-memory reference and IndexedDB adapters. Remaining Phase 2A work starts
with the Capacitor SQLite implementation and Absolute/Auth namespace
provisioning, followed by conflict/dead-letter policy and headless orchestration.

Implementation checkpoint (August 25, 2026, third Phase 2A slice):
`@absolutejs/sync` 2.18.0 extracted a public adapter conformance contract;
2.19.0 added immediate reconnect with a fresh socket ticket; 2.20.0 made
durability runtime-provisionable for unchanged page code; and 2.21.0 added host
lifecycle enrollment for every ordinary multiplexed client. `@absolutejs/auth`
0.70.0 now resolves a verified mobile principal and derives an opaque namespace
from issuer, public client ID, and subject, with an optional server-owned
partition claim. `@absolutejs/sync-capacitor` 0.1.0 passes that shared contract
with transactional native SQLite and reconnects clients on resume/connectivity.

AbsoluteJS 0.20.0-beta.7 composes these pieces automatically whenever an app
already declares Auth and Sync: page code continues to call the normal Auth and
Sync APIs, while the native shell provisions SQLite, ticket Auth, and lifecycle
handling. Identity changes reload the shell before another partition can be
selected, destroying page-held clients and in-memory rows. Logout follows
locked retention: the opaque partition remains on-device for offline recovery
by the same verified account but is unavailable while signed out or signed in
as another account. Mobile init/sync offers to install the tested SQLite plugin
and adapter as direct application dependencies so Capacitor can discover the
native plugin. Remaining Phase 2A work is conflict/dead-letter policy, bounded
headless orchestration, quota/migrations/encryption policy, and richer status
and devtools surfaces.

Implementation checkpoint (August 25, 2026, fourth Phase 2A slice):
`@absolutejs/sync` 2.22.2 adds typed `conflict`, `permanent`, and `retryable`
mutation outcomes. Durable clients retain conflicts/permanent failures as
principal-scoped dead letters, bound explicitly retryable delivery to five
attempts by default, and expose status, finite `flush()`, list, retry, and
discard APIs without a framework dependency. Acknowledgments and rejections no
longer settle the in-memory operation if the corresponding durable store update
fails. `@absolutejs/sync-capacitor` 0.2.0 passes the expanded store contract and
runs a finite outbox flush after resume or restored connectivity.

AbsoluteJS 0.20.0-beta.8 automatically forwards every unchanged native Sync
client through that lifecycle and emits its redacted counters/timestamps as the
`absolute:sync-status` browser event for shell diagnostics. This slice does not
claim operating-system background guarantees: the remaining orchestration work
is a finite HTTP push/pull protocol usable in a separate Background Runner or
service-worker context. Remaining Phase 2A work also includes quota/eviction and
encryption policy, pack-declared conflict reducers, and full devtools remediation
UI.

Implementation checkpoint (August 25, 2026, installed-data upgrade slice):
`@absolutejs/sync` 2.25.0 now owns one logical `SyncLocalStoreSchema` plan for
web and native persistence. Ordered transforms migrate every principal partition
and the schema marker in one IndexedDB transaction, reject missing compatibility
steps and downgrades with typed errors, and forbid rewriting stable operation IDs.
`@absolutejs/sync-capacitor` 0.5.0 applies the identical plan inside one SQLite
transaction. Both adapters prove multi-account upgrades and simulated crash
rollback. Absolute-generated plans from application and pack metadata, doctor
diagnostics, and real installed-APK failure/recovery conformance are now complete;
the current implementation state is summarized in the checkpoints below.

### Phase 3: Capacitor project and CLI lifecycle

Deliverables:

- Idempotent `mobile init`.
- Generated Capacitor config with protected fields.
- sync/run/open/build commands and passthrough.
- native project ownership rules and version checks.
- `mobile doctor`.

Exit criteria:

- Fresh project to simulator/device in documented commands.
- Existing customized native projects survive sync and upgrades.
- Signed test artifacts build in CI for both platforms.

### Phase 4: unified web/mobile development loop

Deliverables:

- Normal `absolute dev` dual-target build graph, browser/mobile URLs and mobile preview.
- First-class emulator controller used by both normal `absolute dev` and explicit
  `mobile dev`: toolchain doctor, guided provisioning, persistent target choice,
  boot readiness, install/launch, logs, screenshots, state reset and headless mode.
- Reachable-host detection, Android `adb reverse`, iOS Simulator loopback, physical-
  device LAN/tunnel strategies, temporary live-reload config, cleanup and HMR forwarding.
- Native-delta classification so web/page/CSS edits use HMR, config/plugin changes
  sync and rebuild, and native source changes rebuild without restarting the dev server.
- HTTPS/LAN and Android cleartext development guidance.
- dev error hints for unreachable server, firewall, wrong host, stale native config, and WebSocket failure.

Exit criteria:

- Code/CSS updates work for representative pages in all frameworks.
- The real Android WebView conformance gate passes all supported page families,
  CSS, error recovery, and lifecycle relaunch in one app session.
- Interrupts and crashes cannot leave production-unsafe config behind.
- Release doctor catches intentionally leaked dev configuration.

### Phase 5: devices core and shell integration

Implementation checkpoint (August 22, 2026): the public
`@absolutejs/devices@0.0.1` foundation is published from
`absolutejs/devices@f8d50d3`. It provides normalized capability and permission
contracts, platform/lifecycle/resume/restored-operation/network/link/back/storage
facades, separate web and SSR entry points, deterministic test adapters, and a
shared adapter conformance harness. Secure storage is deliberately a distinct
provider capability rather than a `localStorage` alias. The release passes 18
contract/runtime/web/SSR/conformance tests, builds every public entry point, and
passes an import test against the exact npm tarball. The Capacitor package remains
unpublished until the real macOS simulator report can inform its lifecycle and
restoration integration instead of freezing assumptions into its first release.

Implementation checkpoint (August 23, 2026):
`absolutejs/devices@04f7641` contains the unpublished
`@absolutejs/devices-capacitor@0.0.1` release candidate. It normalizes Capacitor
App lifecycle/resume/restored results, launch and inbound links, Android hardware
back, Network state, Browser opening, and namespaced Preferences behind the core
facades. External URLs are audited, listener cleanup is idempotent, provider
failures become typed device errors, browser previews retain the web adapter, and
Preferences can neither clear unrelated keys nor masquerade as secure storage.
The adapter and core pass 26 tests/75 assertions plus type, build, and distribution
gates. `@absolutejs/devices@0.0.2` is published with the required realm-scoped
adapter registry; a test builds two physically independent runtime bundles and
proves the shell installation is visible to page code. The Capacitor tarball and
native-only bootstrap API are ready, but the adapter and its final AbsoluteJS
shell dependency remain unpublished until real iOS acceptance.

Implementation checkpoint (August 26, 2026):
`@absolutejs/devices@0.1.0` and `@absolutejs/devices-capacitor@0.2.0` are now
published. The core/provider suite passes 36 tests/117 assertions plus type,
build, public-entry, package, and optional-plugin isolation gates. Clipboard,
Share, and Haptics are separate Capacitor entry points backed by declarative,
exact-version provisioning metadata. AbsoluteJS beta 18 consumes that metadata,
discovers application imports, installs on approval, generates the adapter, and
fails release doctor when a used provider is absent or mismatched. The real iOS
behavior remains an explicit macOS/physical-device handoff item.

The next checkpoint publishes the permission-bearing slice as
`@absolutejs/devices@0.2.0`, `@absolutejs/devices-capacitor@0.3.1`, and
`@absolutejs/sync-capacitor@0.9.0`. The correction from Capacitor adapter 0.3.0
to 0.3.1 keeps optional Camera types out of the base entry so Sync-only apps do
not acquire an accidental Camera peer. AbsoluteJS beta 19 consumes the live
packages, generates camera/photo wiring and iOS descriptions, and includes the
new physical-device acceptance in the macOS handoff.

The exact unpublished adapter tarball has also passed an Android API 36 emulator
smoke through AbsoluteJS's real native controller and WebView debugging path. The
installed app reported the Capacitor Android runtime, native lifecycle/resume and
Network events, Android back capability, namespaced Preferences, and unavailable
secure storage as designed. Preferences survived an `am force-stop` process death
and direct activity relaunch, and the unchanged native app used the Gradle/APK
cache path to reconnect with HMR in 1.80 seconds. Registering a back listener now
explicitly enables Capacitor's Android back handler and rolls back cleanly if that
native call fails. The test emulator's degraded System UI did not deliver either
synthetic key or edge-swipe Back input, so callback delivery remains an explicit
healthy-emulator/physical-device acceptance item rather than a claimed pass.

Deliverables:

- `@absolutejs/devices` core/web/SSR/test package.
- `@absolutejs/devices-capacitor` and Wave 0/1 adapters in small feature slices.
- build-target selection, lifecycle/deep-link/back/restoration bootstrap.
- permission declaration checks and adapter conformance suite.

Exit criteria:

- Same example code works in browser and both native apps.
- SSR imports never touch browser/native globals.
- Unsupported and denied behavior is consistent and tested.
- Unused capabilities do not add their native plugins/permissions.

### Phase 6: production readiness

Deliverables:

- security threat model and release gates.
- offline conflict, retry, cache sensitivity, quota, background limitation, and update behavior guidance.
- deep-link association setup and validation.
- signed CI templates, store checklists, privacy/data-safety guidance.
- native E2E matrix, performance baselines, upgrade tests, observability.
- all-framework reference app and migration documentation.

Exit criteria:

- Release candidate passes physical-device, offline, deep-link, permission, process-death, and upgrade tests.
- No critical/high threat-model findings remain.
- Documentation makes server/mobile boundaries and store requirements unmistakable.

### Phase 7: Expo v2 R&D and experimental release

Expo R&D may start while real iOS Capacitor acceptance is pending because it is
a separate renderer and shell experiment. It must remain behind `engine: 'expo'`
with an experimental warning. Capacitor's real iOS findings become shared bridge
regression requirements, and Expo cannot be called production-ready until Auth,
Sync, deep links, lifecycle, signing, upgrade, and physical-device gates pass for
both shells.

## Documentation set

- Mobile concepts: embedded UI versus deployed server.
- Add mobile to an existing AbsoluteJS app.
- Capacitor config and native project ownership.
- Development on simulator, emulator, LAN device, and CI.
- Automatic route/page-envelope behavior and per-framework caveats.
- Universal data transport, CORS, CSRF, web cookie sessions, native OAuth/PKCE/tokens, secure storage, and deep links.
- Offline and app lifecycle design.
- Device APIs, capabilities, permissions, fallbacks, and testing.
- Custom native code and raw provider escape hatches.
- Signing, release, privacy, app-store review, and upgrades.
- Troubleshooting and `mobile doctor` messages.
- Expo hybrid model and migration, only when v2 exists.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| “Any site becomes an app” is interpreted as embedding the server | Document that the native shell/assets run locally while route/data execution remains on deployed Bun |
| Page envelope leaks private props/tokens through cache | Per-user cache partition/encryption or no-store, schema limits, secret scans, and never serialize auth credentials |
| Old binary receives incompatible server UI/data | Data-only envelopes, bundle/schema negotiation, explicit compatibility window, old-binary fixtures and typed `upgrade-required` |
| Automatic route mapping misses dynamic/plugin routes | Runtime route capture plus authoritative instrumented page finalization; classify or fail opaque responses |
| Remote HTML executes with native privileges | Embedded audited executable assets, sanitized restricted fragments and a method-allowlisted capability bridge |
| Raw browser networking targets the wrong origin or leaks credentials | Guarantee Absolute HTTP/Auth/Sync/HTMX transports, canonical URLs and doctor diagnostics; raw APIs remain best effort |
| Framework roots cannot be safely replaced in one document | Hard document/runtime reset first; optimize only after bounded-lifetime tests |
| Local routing differs across platform WebViews | Phase 0 spike and route-manifest integration tests on both platforms |
| Cross-origin or socket auth fails or becomes insecure | First-class Absolute Auth mobile transport, PKCE, secure storage, normalized principals, one-time socket proof/ticket and deployed-backend spike |
| Adapter abstraction hides meaningful platform differences | Capability/result types plus raw adapter escape hatches |
| Base device package installs too much native code | Feature packages/subpaths and explicit plugin installation |
| Native project automation destroys user changes | Commit Capacitor projects, structural edits, ownership markers, no destructive regeneration |
| Offline replay duplicates a committed side effect after an ack is lost | Durable installation/operation IDs plus bounded server deduplication receipts; packs declare whether external effects are retry-safe |
| Cached private data crosses logout, user, or tenant boundaries | Principal-scoped namespaces, encryption policy, atomic purge/lock, and auth/sync lifecycle conformance tests |
| Background synchronization is treated as guaranteed | Correctness depends on foreground/resume/manual retry; service workers and native background tasks only accelerate finite headless push/pull |
| IndexedDB and native SQLite adapters diverge | One transactional storage contract, shared crash-point suite, migrations, quota tests, and adapter conformance in CI |
| Packs hide unsafe offline semantics | Pack manifest exposes persistence, sensitivity, conflict, retry, and background policies for doctor/release review |
| Store rejection as a repackaged site | Release checklist and mobile-value guidance; never promise approval |
| Capacitor/Expo dependency churn | Compatibility matrix, pinned majors, doctor, scheduled upgrade fixtures |
| Expo hybrid has two JS engines and divergent state | Versioned bridge, Expo-owned routing, durable shared state, explicit route ownership |
| OTA content mismatches native capabilities | Runtime manifest/version invariant and staged rollout/rollback before OTA support |

## Open product questions

Product feedback has resolved several original questions:

- Routes must work normally and be discovered automatically; there is no separate mobile route list.
- Normal `bun dev`/`absolute dev` must expose web and mobile together.
- Capacitor is the default all-framework native application shell.
- Expo exists for advanced native-rendering use cases with the React-only tradeoff.
- Authentication needs a platform-neutral application API with genuinely different web and installed-app transports.
- Offline application data belongs to `@absolutejs/sync` across web and mobile;
  `@absolutejs/pwa` owns the web shell/service-worker surface and may wake Sync.
- Capacitor native projects have several ownership models; the v1 recommendation
  is committed source with structurally maintained generated regions.

The device package decision is resolved: use a public `absolutejs/devices`
monorepo that publishes the dependency-light `@absolutejs/devices` contract and
`@absolutejs/devices-capacitor` adapter separately. Reserve the Expo adapter name
until v2 rather than publishing a placeholder.

The remaining decisions that materially affect the public API are:

1. **Mobile component layer (resolved):** v1 includes optional semantic-HTML navigation/layout primitives from `@absolutejs/absolute/mobile/ui`; the native shell installs them automatically without restyling pages that do not opt in.
2. **Expo scope:** Should `engine: 'expo'` initially mean an all-React-native application, selected native replacement routes in a hybrid shell, or both? The plan can support both over time but should stabilize one first.
3. **Native auth strength:** Should v1 require DPoP/device-bound keys, or ship standards-compliant rotating refresh tokens first and add DPoP after the secure-key spike?
4. **Build service:** Should AbsoluteJS v1 stop at local/native CI builds, integrate an existing AbsoluteJS cloud build/deploy product, or adopt a third-party service such as Appflow? This plan keeps cloud build provider-neutral.
5. **Compatibility window:** How many prior app runtime/schema generations must a
   deployed server retain? The feasibility default to test is current plus two.
6. **HTTP package:** Should the canonical request API publish as
   `@absolutejs/http`, or remain a core client subpath until its contract stabilizes?

## Current transactional navigation checkpoint

The Capacitor and Expo WebView shell now treats route navigation as a transaction.
The trusted page request receives an AbortSignal, newer destinations cancel older
loads, and page disposal/activation is serialized across framework boundaries.
Push/replace history is written only after activation succeeds. A load failure
keeps the current page interactive with an accessible retry action, while a failed
Back/Forward load rolls the browser history pointer back to the visible entry.

History entries carry only an opaque entry ID, index, and route path. Form values,
focus, disclosure state, and scroll positions are held in process memory for
Back/Forward restoration; password, file, hidden, payment-card, one-time-code, and
explicitly excluded subtrees are never captured. Process death clears transient
route state by design. Durable offline state remains the responsibility of the
principal-partitioned, encrypted `@absolutejs/sync` layer.

## Current native background-sync checkpoint

The Capacitor v1 implementation now includes the finite v1 push/pull protocol,
principal-partitioned IndexedDB/SQLite stores, durable mutation receipts,
bounded retries/dead letters, managed Android WorkManager and iOS
BGProcessingTask workers, and a Keychain/Keystore vault shared with foreground
Auth. Refresh-token rotation is serialized across foreground and native work;
sign-out invalidates an in-flight lease so a late worker cannot recreate the
credential.

`syncSocket()` now mounts `/__absolute/sync/background` automatically. When an
Absolute Auth application is mounted first, bearer requests and first-frame
single-use socket tickets resolve through a capability bridge to the same typed
`{ authPrincipal, user }` context. Custom auth supplies
`headless.resolveContext`; missing authentication fails closed. The native
worker sends refresh credentials only to the issuer-advertised HTTPS token
endpoint and sends bearer credentials, collection parameters, mutation
arguments, and returned Sync data only to the exact configured AbsoluteJS
origin. Redirects and cross-origin changes fail closed.

All TypeScript, source-contract, package, security-boundary, and Linux-hosted
Android tests are automated. The remaining platform evidence is native Swift
compilation and real BGProcessingTask behavior on the partner's Mac and physical
iOS device, using `IOS_MACOS_TESTING.md`. Correctness never depends on the OS
scheduler; foreground/resume Sync remains authoritative.

## Current PWA checkpoint

The framework-agnostic PWA bridge is now published in `@absolutejs/pwa@0.13.0`,
backed by `@absolutejs/auth@0.72.0`, `@absolutejs/sync@2.29.0`, and
`@absolutejs/sync-capacitor@0.8.0`. It bundles the real finite Sync runner into
the generated worker, provisions only an opaque Auth namespace through a strict
same-origin session POST, discovers safe persisted collection descriptors, and
uses Background Sync only as an acceleration over foreground/resume
correctness. Native Bearer authentication is unchanged.

The root-framework config phase is complete. Applications now opt in once with
`pwa` in `absolutejs.config.ts`; AbsoluteJS generates the manifest, finite Sync
worker, and a single shared browser bootstrap without route or framework code.
The bootstrap is injected across React, Vue, Svelte, Angular, HTML, HTMX, and
island builds, runs before generated page entries, preserves user Bun banners,
and is reused during incremental HMR. Build telemetry records PWA and PWA-Sync
adoption while the existing `pwa/materialize` trace isolates generation cost.

Runtime Sync outcomes are now available to the application as a typed listener,
a latched latest value, and the `absolute:pwa-sync-result` DOM event. The browser
boundary accepts only status, duration, trigger, and aggregate counts; it drops
namespaces, endpoints, credentials, arguments, and rows. This is a local
application signal, not an automatic analytics channel.

Real persistent-profile Chromium conformance now proves offline fallback after
a full browser restart with the origin unavailable, opaque account A/B worker
reconfiguration, IndexedDB namespace isolation, cookie/principal re-resolution,
logout clearing, and the sanitized telemetry contract. Account refreshes are
latest-wins, old work is aborted before replacement, and worker configuration
events are serialized so network latency cannot restore an older principal.

Real Chromium update conformance now also proves that a changed worker installs
into `waiting`, passive discovery emits a latched update without reload, the old
worker remains in control, and explicit `applyUpdate()` activation reloads once
under the new worker. The planned PWA runtime acceptance matrix is complete.

## Current generated offline-schema checkpoint

AbsoluteJS now composes one JSON-safe local-storage plan from the application
and every direct dependency that declares `absolutejs.sync.localSchema` in its
`package.json`. Component IDs come from package names, ordering is
deterministic, and an undeclared application begins as `@absolutejs/app@1`.
The default compatibility window is the current schema plus two prior versions;
packages can explicitly retain a longer window.

Metadata supports declarative collection deletion, field removal, field rename,
and default insertion. Executable callbacks, malformed JSON values, duplicate
components, gaps, downgrades, and unsupported versions fail the build. The same
generated bundle is embedded in the Capacitor manifest and PWA bootstrap, then
applied transactionally by SQLite or IndexedDB before foreground or background
Sync can read cached rows or flush mutations. Each app/pack ledger advances
independently and removed pack ledgers remain visible as orphan diagnostics.

Pack authors declare only their persisted-data evolution. Application route and
page code remains unchanged. `absolute mobile doctor release` validates and
prints the exact generated component/version set when Sync is installed.

The macOS partner should continue physical iOS acceptance using
`IOS_MACOS_TESTING.md`. Expo remains out of scope until the Capacitor security,
background, and lifetime boundaries pass on a physical iOS device.

## Current local-data policy checkpoint

`@absolutejs/sync` 2.29.0 adds declarative policies to the existing generated
schema components: collection/mutation sensitivity, durable versus memory-only
persistence, encryption requirements, browser memory-only fallback,
whole-projection maximum age, eviction priority, and a per-principal logical
byte ceiling. Private or secret data cannot be declared with unprotected durable
storage. Quota enforcement evicts complete disposable/normal/critical caches in
deterministic oldest-first order and never drops an outbox operation; an outbox
that exceeds the ceiling fails and rolls back instead of losing intent.

IndexedDB accepts an audited synchronous record protector and otherwise fails
closed or uses an explicitly declared collection/mutation memory-only fallback.
AbsoluteJS native provisions `@absolutejs/sync-capacitor` 0.8.0 automatically:
a random AES-256-GCM
key lives in the existing Keychain/Keystore vault, payloads are authenticated to
their principal/kind/name, and only ciphertext is written to SQLite. Android
WorkManager and iOS BGProcessingTask workers read and write the same versioned
envelope. Plain legacy records remain readable and are protected on their next
write. Release doctor reports generated rule, protection, fallback, and quota
counts. The eight stateful official Sync packs now declare policies against
their real configurable-prefix names: private durable caches/outboxes encrypt
on native and fall back to live memory/online-only behavior on an unprotected
browser; presence is always ephemeral; derived counters and digest cursors are
disposable; favorites, notifications, and triage are last-evicted critical
caches. The server-only utils pack intentionally declares no client storage.

The conflict/remediation slice is now implemented. Mutation policy metadata can
declare `manual`, `server-wins`, or bounded `client-wins` behavior. The selected
rule is captured inside each protected outbox record, so WebSocket foreground,
PWA/headless HTTP, Android WorkManager, and iOS BGProcessingTask execution make
the same deterministic decision. An unchanged retry preserves its durable
operation ID because rejected server transactions commit no receipt; an
argument-changing rebase atomically creates a new intent and records the
superseded ID. A realm-shared runtime inspector aggregates pending/dead-letter
counts, oldest ages, last successful push/pull, public rejection codes/messages,
and automatic resolutions without exposing arguments or rejection details.
AbsoluteJS installs the remediation bridge once in the native shell so every
framework can inspect, retry, discard, or explicitly rebase without page wiring.

During Android/iOS development, the existing native HMR client now installs a
Shadow-DOM Sync panel automatically. It displays only the redacted aggregate and
dead-letter projection, badges retained failures, and provides retry, confirmed
discard, and JSON-plus-confirmation rebase controls. It is selected by the same
deterministic native target marker as HMR and is absent from production assets.

Official pack defaults are conservative: comments and favorite toggle operations
remain manual; idempotent favorites, mentions, notifications, and triage receive
one client-wins retry; ephemeral presence accepts the server view. Release doctor
prints the effective strategy counts. Application-facing merge UI remains an
app/product concern, but it can consume the same typed remediation bridge without
depending on Capacitor, React, or the development panel.

## Current cross-platform push checkpoint

Portable push now has one additive contract across web and installed apps.
`@absolutejs/auth@0.75.0` mounts canonical cookie-or-bearer `/auth/push`
registration while retaining `/auth/mobile/push` for installed beta clients;
the trusted server derives principal, tenant, and topics. `@absolutejs/dispatch`
0.9.0 models APNs/FCM tokens and structured Web Push subscriptions without
flattening browser credentials. `@absolutejs/dispatch-push-postgres@0.2.0`
applies an additive native-to-Web-Push schema migration and rotates credentials
atomically by stable installation identity.

`@absolutejs/pwa@0.14.0` installs a web implementation behind the existing
`@absolutejs/devices` `pushNotifications` facade, keeps the opaque installation
identity in page/service-worker shared IndexedDB, re-registers browser-rotated
subscriptions while no page is open, and exposes only normalized receipt/action
events to application code. Registration endpoints and notification action
requests are constrained to the exact origin. AbsoluteJS discovers the portable
capability without requiring Capacitor metadata, reads only the public VAPID key
from `VAPID_PUBLIC_KEY` at build time, and fails with setup guidance if it is
missing. Private VAPID material remains solely in the trusted server sender.

## Current signed mobile-update checkpoint

AbsoluteJS now builds provider-neutral Capacitor updates from the ordinary
all-framework embedded bundle. Every release has an immutable file inventory,
per-file SHA-256 digests, an ECDSA P-256/SHA-256 signature, a store-policy classification,
and an explicit attestation that it stays within the application's submitted
purpose. The private signing key is accepted only by the host CLI. Config and
installed apps contain base64 SPKI public keys for planned rotation.

The generated native-runtime fingerprint covers the shell ABI, engine, exact
device providers/plugins and native declarations, deep links, native Auth
identity, generated Sync schema, update endpoint/channel, and key set. Ordinary
page/route/asset changes retain the fingerprint; a native, permission, Auth, or
local-data boundary change requires a store build automatically.

The Capacitor shell uses an anonymous installation UUID for deterministic
rollouts, fetches without cookies or credentials, verifies the signature before
downloading, hashes every bounded file, and commits only the complete staging
transaction. Activation switches the WebView root without persisting it. The
new shell persists itself only after its initial route renders; a boot failure
therefore restores the previously confirmed bundle on the next app launch.
Generated iOS startup recovery also clears a persisted Capacitor snapshot path
that disappeared during device migration.

`@absolutejs/deploy` owns the adjacent immutable BlobStore registry, staged
channel/fallback state, anonymous cohort selection, compatible-runtime
resolution, CORS-constrained HTTP delivery, promotion, and rollback. The core
CLI exposes `mobile update build`, `publish`, `promote`, and `rollback` without
coupling clients to a cloud provider. The full contract and commands are in
`MOBILE_UPDATES.md`. Expo remains a later adapter over the same control-plane
invariants and its own native runtime/version mechanism.

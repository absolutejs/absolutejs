# AbsoluteJS Expo hybrid experiment

Introduced experimentally in `@absolutejs/absolute@0.20.0-beta.40`; the
first-class combined development loop was added in `0.20.0-beta.41`, HTTPS in
`0.20.0-beta.42`, Remote Mac iOS execution in `0.20.0-beta.43`, and native-owned
Auth plus authenticated HTTP in `0.20.0-beta.44`. Native-owned durable Sync is
added in `0.20.0-beta.45`. Provider-neutral Expo device capabilities are added
in `0.20.0-beta.46` through `@absolutejs/devices-expo@0.0.2`.
Parameterized and terminal-wildcard native route ownership is added in
`0.20.0-beta.47`. Automatic typed server page-props delivery to native routes
is added in `0.20.0-beta.48`.
Expo Android production builds, release auditing, immutable AAB retention,
generated CI, and Google Play publishing are added in `0.20.0-beta.49`.
Expo iOS production builds, release auditing, immutable IPA retention,
generated CI, and TestFlight publishing are available in `0.20.0-beta.51`.

AbsoluteJS can generate an experimental Expo Router shell in which explicitly
selected routes render React Native UI and all other routes remain ordinary
AbsoluteJS pages. Capacitor remains the default mobile engine. Expo Android and
iOS are now supported experimental production paths.

This experiment does not convert HTML, React DOM, Vue, Svelte, Angular, Ember,
or HTMX into React Native. It embeds their existing signed AbsoluteJS page
bundles in an Absolute-owned WebView host. Only modules listed under
`mobile.routes.native` use React Native primitives.

## Current boundary

Implemented in the first spike:

- Expo SDK 57 and Expo Router shell generation;
- CNG app configuration for the application ID, custom scheme, Android App
  Links, and iOS Universal Links;
- explicit, conflict-free ownership of static, parameterized, and
  terminal-wildcard native routes;
- a WebView catch-all for every unclaimed AbsoluteJS route;
- content-addressed embedded web assets copied through Metro as opaque assets
  and restored with their original paths on the device;
- Expo Router deep-link ownership and native-route transitions from web links;
- Android WebView-history Back handling;
- a versioned, size-bounded, allowlisted request/response bridge;
- page-envelope GET transport through the native bridge so the server never has
  to trust an opaque `file://` origin;
- automatic source-level discovery of ordinary `@absolutejs/devices` imports;
- generated Expo SDK packages, CNG plugins, Android permissions, iOS privacy
  descriptions, and privacy-manifest entries for only detected capabilities;
- camera and scoped photo picking, clipboard, bounded document pick/export/open,
  haptics, keyboard, foreground location, local notifications, native APNs/FCM
  push, share, and system-bar controls from ordinary embedded routes;
- the same provider-neutral device facade in application-owned React Native
  routes, with no raw Expo imports required;
- native-owned push installation registration through provisioned AbsoluteJS
  Auth without exposing a provider token to WebView code;
- 24 KiB chunked binary transfers, 64 MiB object limits, bounded concurrency,
  expiry cleanup, and stripping of native-only fields at the bridge;
- a generated native diagnostic screen at `/__absolute/native`;
- an Expo SDK 57 development client managed by `bun dev`;
- one Metro process plus configured Android/iOS local builds and launch;
- native React Fast Refresh alongside framework-aware AbsoluteJS page HMR;
- distinct `expo-android` and `expo-ios` timing logs and redacted telemetry;
- local HTTPS CA projection for Android, iOS Simulator, and physical iOS;
- Expo iOS development through a paired developer-owned Remote Mac, including
  separate Bun and Metro tunnels and physical-device LAN relays;
- live-history bridge synchronization across SPA navigation.
- automatic `@absolutejs/auth-expo@0.0.2` provisioning whenever the application
  depends on `@absolutejs/auth`;
- system-browser S256 PKCE through Expo WebBrowser, cold/warm callback handling,
  and refresh-on-resume;
- refresh credentials held only in Expo SecureStore with device-only,
  after-first-unlock semantics;
- one native Auth owner shared by native React routes and embedded web routes;
- typed sign-in, sign-up, sign-out, status, principal-event, and
  authenticated HTTP bridge operations without exposing access/refresh tokens;
- exact-origin HTTP with native bearer injection, serialized refresh and one
  retry on `401`, bounded bodies, forbidden application Authorization headers,
  and rejected redirects.
- automatic `@absolutejs/sync@2.31.0` and
  `@absolutejs/sync-expo@0.0.2` provisioning when Auth and Sync are already
  used by the application;
- one encrypted Expo SQLite cache/outbox shared by native React routes and
  ordinary embedded routes, with Auth-principal partitioning and generated
  schema migrations;
- direct provider-neutral Sync transport for native routes and a typed
  native-owned transaction proxy for WebView routes, requiring no page edits;
- native-owned exact-origin WebSockets whose one-time Auth ticket never crosses
  the WebView bridge, including bounded chunking for frames larger than one
  bridge envelope;
- foreground, resume, and connectivity flush/reconnect handling plus bounded
  Expo BackgroundTask push/pull acceleration;
- process-restart durability, transactional migration rollback, schema
  downgrade rejection, readonly enforcement, quota/policy enforcement, and
  account-isolation conformance coverage;
- clean production Android CNG, signed or explicitly unsigned AAB builds,
  immutable content-addressed release metadata, automatic Google Play version
  codes, release-doctor enforcement, generated protected CI, and the existing
  resumable Google Play publisher.
- clean production iOS CNG, generated Xcode workspace/scheme discovery, signed
  or explicitly unsigned IPA builds, immutable content-addressed release
  metadata, automatic App Store build numbers, release-doctor enforcement,
  generated protected CI, and the existing resumable TestFlight publisher.

Not implemented, and therefore not claimed:

- Android process-death restoration of an in-flight Expo image picker result;
- EAS Update, rollback, process-death, physical-device, accessibility, or
  performance acceptance;
- Expo Android production builds from WSL. Use generated Linux CI or native
  Windows/Linux/macOS for this checkpoint.

Unsupported device capabilities still fail rather than silently degrading. The
two JavaScript engines do not share globals: Auth and Sync cross only through
typed bridge contracts, while long-lived credentials, socket tickets, and
namespace selection remain in the native runtime and never enter WebView
storage.

## Configure it

From the application root—the directory containing `package.json`, the
AbsoluteJS config, and the server entry—use:

```ts
import { defineConfig } from '@absolutejs/absolute';

export default defineConfig({
  mobile: {
    engine: 'expo',
    appId: 'com.example.product',
    appName: 'Product',
    entry: '/',
    platforms: ['ios', 'android'],
    server: {
      productionOrigin: 'https://api.example.com'
    },
    deepLinks: {
      scheme: 'product',
      hosts: ['app.example.com']
    },
    routes: {
      default: 'web',
      native: {
        '/scanner': './mobile/native/scanner.tsx',
        '/products/:productId': './mobile/native/product.tsx',
        '/files/*': './mobile/native/files.tsx'
      }
    }
  }
});
```

The native module is ordinary application-owned source. Reuse the page-props
type already owned by the corresponding AbsoluteJS page; the generated route
loader runs that same server route and supplies its result automatically:

```tsx
import type { AbsoluteNativeRouteProps } from '@absolutejs/absolute/mobile';
import type { ProductPageProps } from '../../src/pages/Product';
import { Pressable, SafeAreaView, Text } from 'react-native';

type ProductParams = { productId: string };

export default function Product({
  pageProps,
  params,
  reload
}: AbsoluteNativeRouteProps<ProductPageProps, ProductParams>) {
  return (
    <SafeAreaView>
      <Text>{pageProps.name}</Text>
      <Text>Native product {params.productId}</Text>
      <Pressable onPress={reload}>
        <Text>Refresh</Text>
      </Pressable>
    </SafeAreaView>
  );
}
```

`pageProps` is not a second client-side API contract. It is the JSON-safe props
produced by the ordinary framework page handler for the same URL, after its
normal server code and Auth checks run. Changing `ProductPageProps` therefore
checks both renderers at compile time. AbsoluteJS owns the loading, retry,
same-origin request, envelope, size, page-identity, and release-compatibility
logic. Application code does not fetch its own page props or handle an access
token. When `@absolutejs/auth` is installed, the generated native Auth runtime
adds and refreshes authorization without exposing credentials to the route.

Named `:params` claim exactly one path segment and arrive in `params`. A final
`*` claims one or more remaining segments and arrives as
`params.absoluteWildcard`. Query parameters are included too. A root `/*`,
repeated/invalid parameter names, equivalent patterns such as `/users/:id`
plus `/users/:name`, and Expo/Metro reserved paths are rejected at config load.
The server page route itself requires no edit; `mobile.routes.native` only
declares that Expo should render that existing URL with the application-owned
native module. Removing the mapping prunes only its AbsoluteJS-managed wrapper;
application-owned native modules remain untouched.

During development, the generated loader requests the current page-props
contract so server edits and Metro Fast Refresh remain immediate. This
header-light representation is rejected outside `NODE_ENV=development`. A
prepared production shell instead embeds the signed release's origin, runtime,
page identity, bundle hash, and contract, then uses the full compatibility
protocol. That lets the server retain an older app's matching representation
without asking developers to write version checks or migrations in the native
screen.

## Generate and run it

Run each AbsoluteJS command from the application root. Replace the server entry
only if the application uses a different path.

```sh
cd /absolute/path/to/the/application
bun dev
```

Run that command from the application root, not from the generated Expo
directory. If the project does not expose `bun dev`, run its equivalent
directly:

```sh
bunx absolute dev src/backend/server.ts --config absolute.config.ts
```

On the first run AbsoluteJS generates the shell, offers to install its pinned
SDK 57 development-client dependencies, checks the configured Android/iOS
toolchains, starts Bun and Metro, and builds/launches each locally supported
target. A non-macOS host runs Android locally and, when a Remote Mac is paired,
builds and launches Expo iOS there. Without a paired Mac it explains the exact
pairing command and continues with locally supported targets.

Each development session regenerates the disposable Android/iOS directories
with clean Expo CNG before compiling the development client. This guarantees
that configuration and native dependency changes are projected without asking
the application author to edit generated native code. Once connected, ordinary
route edits stay on Metro Fast Refresh or AbsoluteJS HMR and do not repeat CNG,
Gradle, or Xcode compilation.

Expo development uses the same `dev.https` setting as the web and Capacitor
targets. For Android, AbsoluteJS projects its local CA through Android's
debug-only Network Security Configuration while CNG generates the disposable
native project. For an iOS Simulator it installs the CA into that simulator's
trusted-root store and relaunches the app. A physical iOS device receives the
same short-lived, tokenized enrollment URL used by Capacitor and prints the
exact profile-install and trust steps. AbsoluteJS never disables certificate
validation, and a clean production prebuild cannot include the development CA
plugin because it is activated only by the Expo development environment.

For production-bundle/CNG inspection, the lower-level commands remain:

```sh
bunx absolute mobile init --no-native --yes --config absolute.config.ts
bunx absolute prepare src/backend/server.ts --config absolute.config.ts
bunx absolute mobile sync --yes --config absolute.config.ts
```

`mobile init` generates the managed shell and installs its pinned dependencies.
`prepare` creates the signed compatibility bundle and automatically stages it
for Expo. `mobile sync` runs Expo Prebuild after synchronizing the CNG config and
embedded assets.

## Build, audit, and publish Android

Run these from the application root, never from `.absolutejs/mobile/expo`:

```sh
bunx absolute mobile build android src/backend/server.ts
bunx absolute mobile doctor release android
bunx absolute mobile ci github src/backend/server.ts --publish
```

`mobile build android` prepares the ordinary AbsoluteJS application, regenerates
Android through clean Expo CNG, installs the pinned generated-shell packages,
embeds the compatibility bundle, and runs Gradle `bundleRelease`. Development
origins, development CA configuration, and development-mode flags are removed
from both Prebuild and Metro/Gradle environments. The release doctor verifies
the generated app configuration, installed SDK versions and lockfile, one-to-one
opaque asset projection, bundle hashes, CSP, deep links, native debugging,
cleartext/development trust, Sync policy, and detected device packages.

The immutable AAB and `release.json` are written beneath
`.absolutejs/mobile/releases/android/`. Existing `mobile.release.ts` registry
publication and `--play-track internal|alpha|beta|production` work unchanged.

For iOS, run the corresponding commands on macOS with Xcode and signing
configured, or from Windows/Linux through a paired Mac:

```sh
bunx absolute mobile build ios src/backend/server.ts
bunx absolute mobile doctor release ios
bunx absolute mobile publish ios src/backend/server.ts --registry mobile.release.ts --testflight-group internal-testers

# Windows/Linux (the --remote flag is optional when a default Mac is paired)
bunx absolute mobile build ios src/backend/server.ts --remote personal-mac
bunx absolute mobile publish ios src/backend/server.ts --remote personal-mac --registry mobile.release.ts --testflight-group internal-testers
```

AbsoluteJS regenerates iOS through clean Expo CNG, discovers the single
generated application workspace and shared scheme, archives/exports with
Xcode, verifies signing, and retains `App.ipa` plus `release.json` beneath
`.absolutejs/mobile/releases/ios/`. `--unsigned` is an explicit local audit
escape hatch; unsigned output is not store-publishable by default. Generated
GitHub CI emits both configured platform jobs, with iOS on a protected macOS
runner using the same IPA/TestFlight contracts as Capacitor.

The generated Expo project defaults to
`.absolutejs/mobile/expo`. AbsoluteJS owns that entire directory; edit
`absolute.config.ts` or an application-owned native route module, not generated
files. A custom non-empty `mobile.nativeProject.directory` is not adopted unless
the first generation explicitly uses `--force`.

After connection, edits to application-owned native route modules use Metro
Fast Refresh. Edits to React DOM, Vue, Svelte, Angular, HTML, HTMX, CSS, and
other ordinary AbsoluteJS routes stay on the existing Bun HMR graph and do not
run Gradle or Xcode. The terminal prints Metro/native build phases and the
existing HMR log includes the Expo target plus server, client, and total apply
time. `d` displays both ports and target state from the AbsoluteJS dev prompt.

## Bridge and security model

The WebView can send JSON only through the generated bridge. Messages use
format `3`, have a maximum encoded size of 64 KiB, require bounded request IDs
and application paths, and dispatch only explicit method names. The
allowlisted method families are `devices`, `http`, `auth`, and the typed
`sync.store`, `sync.tx`, and `sync.socket` operations. HTTP is locked to the
exact configured `productionOrigin`, accepts only bounded GET/POST/PUT/PATCH/
DELETE requests and audited headers, rejects caller-supplied Authorization and
redirects, strips response headers other than content type/cache policy, and
currently caps request and response bodies at 48 KiB.
Ordinary operations time out after 30 seconds; user-driven pickers and
permission prompts allow up to five minutes. The native host verifies that a
request identifies the currently owned web path. External navigation opens
through the operating system instead of loading into the application WebView.

No arbitrary JavaScript method, raw Expo module, bearer token, refresh token,
socket ticket, native namespace selector, or raw Sync database is exposed to
embedded page code.

## Provider-neutral devices

Application code does not select or import an Expo adapter. It keeps using the
same facade as web and Capacitor code:

```ts
import { camera, documents, location, share } from '@absolutejs/devices';
```

AbsoluteJS discovers value imports in JavaScript, TypeScript, React, Vue, and
Svelte source, reads the declarative catalog from `@absolutejs/devices-expo`,
and regenerates the owned Expo project. The next `bun dev` or
`absolute mobile sync` offers to install newly required pinned SDK packages.
Do not edit `app.json`, `package.json`, Android, iOS, or bridge code under
`.absolutejs/mobile/expo`.

Web previews continue to use standards APIs. Capacitor builds use
`@absolutejs/devices-capacitor`; Expo native and embedded routes use
`@absolutejs/devices-expo`. Push is deliberately different: the raw APNs/FCM
token remains native and is registered with the trusted `/auth/push` route
provisioned by `@absolutejs/auth`.

## Sync ownership and limits

Application code continues to import and use `@absolutejs/sync` normally. A
native React route talks directly to the generated Expo SQLite store. An
embedded route receives the same `SyncLocalStore` contract through a bounded
RPC proxy; every transaction is committed or rolled back by native code and an
abandoned transaction is rolled back automatically. The native Auth principal
selects the partition regardless of any namespace supplied by page code.

The default JSON/string Sync serializer is supported across the WebView socket
bridge. Binary custom serializers fail explicitly. A logical socket frame may
be up to 4 MiB and is split into 24 KiB binary chunks so each encoded bridge
message stays below 64 KiB. The native host obtains and consumes the one-time
socket ticket before it reports the socket open.

BackgroundTask is only an accelerator: Android and iOS decide when it runs, the
minimum requested interval is 15 minutes, and iOS does not execute background
tasks in Simulator. Startup, foreground resume, connectivity recovery, and
manual retry remain the correctness path. Account changes reload the JavaScript
runtime so an old route cannot retain another principal's in-memory state.

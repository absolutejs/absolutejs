# AbsoluteJS Expo hybrid experiment

Introduced experimentally in `@absolutejs/absolute@0.20.0-beta.40`; the
first-class combined development loop was added in `0.20.0-beta.41`.

AbsoluteJS can generate an experimental Expo Router shell in which explicitly
selected routes render React Native UI and all other routes remain ordinary
AbsoluteJS pages. Capacitor remains the default mobile engine and the supported
production path.

This experiment does not convert HTML, React DOM, Vue, Svelte, Angular, Ember,
or HTMX into React Native. It embeds their existing signed AbsoluteJS page
bundles in an Absolute-owned WebView host. Only modules listed under
`mobile.routes.native` use React Native primitives.

## Current boundary

Implemented in the first spike:

- Expo SDK 57 and Expo Router shell generation;
- CNG app configuration for the application ID, custom scheme, Android App
  Links, and iOS Universal Links;
- explicit, conflict-free ownership of static native routes;
- a WebView catch-all for every unclaimed AbsoluteJS route;
- content-addressed embedded web assets copied through Metro as opaque assets
  and restored with their original paths on the device;
- Expo Router deep-link ownership and native-route transitions from web links;
- Android WebView-history Back handling;
- a versioned, size-bounded, allowlisted request/response bridge;
- page-envelope GET transport through the native bridge so the server never has
  to trust an opaque `file://` origin;
- `@absolutejs/devices` haptics from embedded web routes through that bridge;
- a generated native diagnostic screen at `/__absolute/native`;
- an Expo SDK 57 development client managed by `bun dev`;
- one Metro process plus configured Android/iOS local builds and launch;
- native React Fast Refresh alongside framework-aware AbsoluteJS page HMR;
- distinct `expo-android` and `expo-ios` timing logs and redacted telemetry;
- live-history bridge synchronization across SPA navigation.

Not implemented, and therefore not claimed:

- `@absolutejs/auth-expo`, `@absolutejs/sync-expo`, secure credential sharing,
  or shared durable state between the native and web JavaScript engines;
- device capabilities other than haptics;
- dynamic or wildcard native route ownership;
- Expo release, signing, store publishing, EAS Update, rollback, process-death,
  physical-device, accessibility, or performance acceptance;
- local HTTPS development CA projection and Expo execution through Remote Mac;
- Expo production support.

An Expo build fails rather than substituting Capacitor Auth, Sync, or device
providers. This is deliberate: the two JavaScript engines do not share globals,
and long-lived credentials must never be copied into WebView storage.

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
        '/scanner': './mobile/native/scanner.tsx'
      }
    }
  }
});
```

The native module is ordinary application-owned source:

```tsx
import { Link } from 'expo-router';
import { SafeAreaView, Text } from 'react-native';

export default function Scanner() {
  return (
    <SafeAreaView>
      <Text>Native scanner screen</Text>
      <Link href="/">Back to the AbsoluteJS app</Link>
    </SafeAreaView>
  );
}
```

Native routes must currently be static paths. Existing page routes require no
edits and must not be repeated in the config.

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
target. A non-macOS host runs Android and explains that Expo iOS requires local
macOS until the existing Remote Mac protocol gains an Expo executor.

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
format `1`, have a maximum encoded size of 64 KiB, require bounded request IDs
and application paths, and dispatch only explicit method names. The first
allowlisted methods are `devices.haptics.impact` and a GET-only `http.fetch`.
HTTP is locked to the exact configured `productionOrigin`, permits only the
generated envelope headers, rejects redirects, strips response headers other
than content type/cache policy, and currently caps response bodies at 48 KiB.
Requests time out after ten seconds. The native host verifies that a request
identifies the currently owned web path. External navigation opens through the
operating system instead of being loaded into the application WebView.

No arbitrary JavaScript method, raw Expo module, bearer token, refresh token,
or Sync database is exposed to embedded page code. Auth and Sync will use
separate Expo adapters plus typed shell events after their threat model and
cross-engine conformance tests exist.

# AbsoluteJS Expo hybrid experiment

Introduced experimentally in `@absolutejs/absolute@0.20.0-beta.40`.

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
- a generated native diagnostic screen at `/__absolute/native`.

Not implemented, and therefore not claimed:

- `@absolutejs/auth-expo`, `@absolutejs/sync-expo`, secure credential sharing,
  or shared durable state between the native and web JavaScript engines;
- device capabilities other than haptics;
- dynamic or wildcard native route ownership;
- one-command combined AbsoluteJS/Metro HMR;
- Expo release, signing, store publishing, EAS Update, rollback, process-death,
  physical-device, accessibility, or performance acceptance;
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

To run Android, open a second terminal:

```sh
cd /absolute/path/to/the/application/.absolutejs/mobile/expo
bun run android
```

On macOS, run iOS from the same generated project directory:

```sh
cd /absolute/path/to/the/application/.absolutejs/mobile/expo
bun run ios
```

After the first native build, native TypeScript edits use Metro Fast Refresh:

```sh
cd /absolute/path/to/the/application/.absolutejs/mobile/expo
bun run start
```

Changes to ordinary AbsoluteJS pages currently require rerunning `absolute
prepare` from the application root and reloading the Expo app. Combined
AbsoluteJS HMR is a separate milestone and remains a requirement before an
experimental release.

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

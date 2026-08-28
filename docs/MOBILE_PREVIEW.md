# AbsoluteJS mobile preview

When `mobile` is configured, normal `bun dev` prints a **Mobile** URL next to
the web URL:

```text
➜  Local:   http://localhost:3000/
➜  Mobile:  http://localhost:3000/__absolute/mobile-preview
```

Open the Mobile URL in a browser. It runs the application's real development
page and HMR graph inside an iOS- or Android-shaped target. It is an AbsoluteJS
runtime target, not responsive viewport emulation: `@absolutejs/devices` sees a
realm-shared Capacitor-shaped test provider and `@absolutejs/http` uses a
preview-owned, same-origin web transport.

## Controls

The preview panel can:

- switch between iOS and Android platform identity and safe-area values;
- open a normal application route or emit it through the deep-link contract;
- change Wi-Fi, cellular, and offline state;
- emit active, inactive, and background lifecycle transitions;
- emit hardware Back and keyboard visibility changes; and
- set camera, location, and notification permission states.

Offline mode updates the `@absolutejs/devices` Network capability and rejects
application requests through both global `fetch` and `@absolutejs/http`.
AbsoluteJS development infrastructure remains connected so HMR and the error
overlay keep working while the simulated application is offline.

HMR acknowledgements use the distinct `mobile-preview` target. Terminal output
includes the same server/client split as installed targets:

```text
[hmr:mobile-preview] react component ... applied in 34ms; server 12ms, client 22ms
```

Opt-in telemetry records only preview target, simulated platform, provider, and
numeric startup/HMR durations. It does not record app identity, routes, source
paths, device data, HTTP contents, or control values.

## What it does not replace

The preview is the fast, SDK-free development target for application behavior
and provider-neutral contracts. It does not claim to reproduce native
rendering, WebView engine differences, system-browser OAuth callbacks, native
secure storage, push delivery, signing, store packaging, background scheduler
behavior, or process death. Use Android emulation and the macOS/iOS workflow for
those platform gates.

The current preview deliberately matches AbsoluteJS's unified live-development
path. Production Capacitor builds still launch the embedded local shell and use
the versioned page-envelope protocol; their compatibility and upgrade behavior
is covered by the installed-app conformance suites.

## Physical Android development and HTTPS

The same `dev.https` setting used by the web target also applies to Capacitor;
there is no separate native HTTPS configuration. To select an authorized
physical Android device explicitly:

```sh
adb devices
bunx absolute dev --android-device DEVICE_SERIAL
```

AbsoluteJS binds the configured dev server to the LAN, regenerates its existing
development certificate only when the selected LAN identity is missing, and
loads the physical app from that HTTPS origin. It temporarily projects the CA
into Android's debug-only Network Security Configuration, then restores any
pre-existing manifest/resources—or removes generated ones—when the session
closes or crash recovery runs. It never installs the CA system-wide on the
phone, and release doctor rejects a leaked AbsoluteJS development trust
reference.

Managed Android emulators keep using `adb reverse` and iOS Simulator keeps using
loopback. With HTTPS enabled, AbsoluteJS uses `simctl keychain` to install the
same existing development CA into the selected iOS Simulator trust store. A
remote Mac receives only the public CA certificate over the already paired SSH
session; the CA private key never leaves the development host.

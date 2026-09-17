# Mobile branding and native assets

AbsoluteJS uses one typed `mobile.branding` contract to generate app icons,
adaptive and themed Android icons, iOS appearance variants, and launch screens
for both Capacitor and Expo. Application code does not import either platform's
asset API and normally does not edit a native asset catalog.

## Configure source artwork

Run every command in this guide from the application root: the directory that
contains `package.json` and `absolute.config.ts`.

```ts
export default {
	mobile: {
		appId: 'com.example.app',
		appName: 'Example',
		branding: {
			icon: 'assets/mobile/icon.png',
			android: {
				backgroundColor: '#FFFFFF',
				foreground: 'assets/mobile/android-foreground.png',
				monochrome: 'assets/mobile/android-monochrome.png'
			},
			ios: {
				darkIcon: 'assets/mobile/ios-dark.png',
				tintedIcon: 'assets/mobile/ios-tinted.png'
			},
			splash: {
				backgroundColor: '#FFFFFF',
				darkBackgroundColor: '#111111',
				logoScale: 0.2
			}
		},
		server: { productionOrigin: 'https://example.com' }
	}
};
```

Only `icon` is required. Source paths are project-relative PNG files. Icon and
icon-layer sources must be square and at least 1024×1024. Optional precomposed
`splash.image` and `splash.darkImage` sources must be square and at least
2732×2732. Each input is bounded to 32 MiB. Colors use `#RRGGBB`; `logoScale`
is between `0.1` and `0.4`.

Keep Android foreground artwork inside the adaptive-icon safe zone. A
transparent monochrome layer enables Android themed icons. The base icon is
used when an optional platform variant is absent.

## Generate and verify

```sh
cd /absolute/path/to/the/application
bunx absolute mobile assets --preview --yes
bunx absolute mobile assets --check
```

The first Capacitor run offers to install the pinned official
`@capacitor/assets` generator as a direct development dependency. `--yes`
accepts that prompt in automation. AbsoluteJS invokes its package binary through
Bun, then adds Android monochrome and iOS dark/tinted resources that the
upstream generator does not currently emit. Expo receives the equivalent typed
app configuration and managed inputs before CNG prebuild.

Use a platform argument for an incremental native projection:

```sh
bunx absolute mobile assets android --yes
bunx absolute mobile assets ios --yes
```

For Capacitor, the check stays stale until every platform configured in
`mobile.platforms` has been generated for the current source fingerprint. A
successful generator exit is also rejected if its expected native output is
missing. Expo writes both platform configurations and their shared managed
inputs together before the requested CNG prebuild.

`--preview` writes `.absolutejs/mobile/branding/preview.html`. It is a quick
mask and launch-layout review, not a replacement for checking the installed app
on real launchers and devices. `--json` returns a script-friendly, non-secret
status. `absolute mobile sync` automatically reprojects configured branding,
and `absolute mobile doctor release` warns when branding is absent and fails
when configured inputs are invalid, stale, or incomplete.

## Generated ownership

Commit the source artwork and the resulting native resources according to the
application's existing native-project policy. Do not edit files under
`.absolutejs/mobile/branding/input`, Expo's `assets/absolute-branding`, Android
launcher resource directories, or the iOS `AppIcon.appiconset` by hand; rerun
`absolute mobile assets` after changing the typed config or source PNGs. The
manifest stores project-relative paths, dimensions, byte counts, and SHA-256
hashes. It does not store credentials or absolute filesystem paths.

Apple Icon Composer can produce more elaborate layered Liquid Glass artwork
than a flat PNG asset catalog. That remains an advanced native override rather
than part of the portable contract: generated PNG appearance variants are the
deterministic write-once path for Capacitor and Expo. A team adopting a manual
Icon Composer asset owns that native-only override and must revalidate it after
native regeneration.

## macOS partner acceptance checklist

Perform this section from a supplied staging application's root, not from the
AbsoluteJS framework clone or a generated `ios` directory.

```sh
cd /absolute/path/to/the/staging-application
pwd
test -f package.json && echo "application root: OK"
test -f absolute.config.ts && echo "config: OK"
bun install --frozen-lockfile
bunx absolute mobile assets --preview --yes
bunx absolute mobile assets --check --json
bunx absolute mobile sync ios --yes
bunx absolute mobile doctor release
```

Return this checklist with the terminal output:

- [ ] `BRAND-IOS-01` Both `application root: OK` and `config: OK` printed.
- [ ] `BRAND-IOS-02` The assets command completed and the JSON check reported
  `configured: true`, `ready: true`, and `status: "ready"`.
- [ ] `BRAND-IOS-03` The preview showed the expected base icon and launch
  sizing; its fingerprint matched the generated manifest.
- [ ] `BRAND-IOS-04` iOS sync completed without an application-authored native
  edit.
- [ ] `BRAND-IOS-05` Xcode's asset catalog contained the expected base icon and
  every configured dark/tinted appearance.
- [ ] `BRAND-IOS-06` The Simulator home screen showed the correct app icon and
  a cold launch showed the correct light launch screen.
- [ ] `BRAND-IOS-07` With dark appearance enabled, a terminated cold launch
  showed the configured dark launch color/artwork.
- [ ] `BRAND-IOS-08` Changing one copy of a source PNG made
  `mobile assets --check` fail as stale; restoring it and regenerating returned
  the check to ready.
- [ ] `BRAND-IOS-09` `mobile doctor release` passed `mobile.branding`.
- [ ] `BRAND-IOS-10` Return the AbsoluteJS package version, engine, macOS/Xcode
  versions, checklist, and command output. Do not send signing credentials,
  Apple account/device identifiers, or unrelated application data.

If Expo is the configured engine, also confirm `app.json` contains the managed
`expo-splash-screen` plugin and iOS icon appearances before prebuild. If no
staging application with committed source artwork was supplied, mark this whole
checklist `BLOCKED — staging application and artwork not supplied`; do not
invent product branding.

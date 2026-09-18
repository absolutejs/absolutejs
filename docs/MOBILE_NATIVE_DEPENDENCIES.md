# Native dependency compatibility

AbsoluteJS provisions a tested native package set. Applications should use the
normal commands from their application directory:

```sh
bunx absolute mobile init --yes
# After enabling more native capabilities:
bunx absolute mobile sync android --yes
```

Omit `--yes` to review installation prompts interactively. Initialization checks
resolved versions of the Devices core, Capacitor Devices adapter, and Capacitor
Sync adapter, including packages already declared in `package.json`. A stale or
unreadable installed version is selected for repair with the tested version. The
CLI verifies the result after installation instead of trusting the package
manager's exit status. Hoisted workspace packages are accepted; a stale or
malformed nearer copy cannot be hidden by a matching parent installation. Capability
plugins are then discovered from the installed adapter, so the shell's keyboard
and system-bar requirements are not hidden by an outdated adapter manifest.

If installation reports success but the verification still fails, the error lists
the unresolved versions. Repair the workspace dependency installation before
retrying. This check never deletes package directories or silently substitutes
the framework's own copy of an incompatible application dependency.

In the local Bun hoisted-workspace reproduction, even `bun install --force` left
obsolete fixture-local copies in place. The maintainer repair was to move only the
affected fixtures' generated `node_modules` directories to a recoverable backup,
then install from the workspace root and rerun initialization. This is a clean
dependency reinstall, not a patch to installed package code. Do not move source,
native projects, or application data, and do not clean a live workspace while
other builds are using it.

The shared internal pins are in `src/mobile/nativePackages.ts`; Expo shell
generation uses the same Devices core version. The framework regression suite
checks the selected versions against installed peer contracts and verifies that
Sync and the application resolve the same Devices runtime pair.

## September 2026 audit

The CLI previously selected Devices 0.5.0, Devices Capacitor 0.6.1, and Sync
Capacitor 0.9.1, while the framework used Devices 0.7.0 and Devices Capacitor
0.8.0. Sync Capacitor 0.9.1 and 0.9.2 declared peer ranges that excluded both
pairs. The CLI also did not repair an already-installed stale Sync adapter.

The corrected set is Devices 0.7.0, Devices Capacitor 0.8.0, and Sync Capacitor
0.9.3. The adapter release adds the newly tested peer pair and retains its older
declared ranges. It does not newly certify intermediate Devices release lines.
Expo remains on Devices Expo 0.0.11 and Sync Expo 0.0.4; the Devices core pin is
shared with Capacitor. Do not hide peer incompatibilities with overrides or
manually patch `node_modules`.

The public CLI was exercised twice against each Capacitor release fixture after
the dependency repair. The first initialization discovered and installed
`@capacitor/keyboard@8.0.5`; the second verified the configuration without another
dependency installation. The independently tested Sync Capacitor 0.9.3 release
is published. The framework provisioning changes remain source-only until the
installed native acceptance checks pass; no new framework beta is published by
this audit.

This audit verifies dependency contracts, provisioning, and adapter tests. It is
not installed-device certification. The authenticated Android release gate is
still pending the emulator startup investigation documented in
[MOBILE_RELEASE_DATA_TESTING.md](MOBILE_RELEASE_DATA_TESTING.md), and iOS still
requires the partner's Mac/device checklist.

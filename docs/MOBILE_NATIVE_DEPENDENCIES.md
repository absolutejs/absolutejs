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

## Which `@capacitor/*` packages this framework declares, and why

Three are hard dependencies: `@capacitor/browser`, `@capacitor/filesystem` and
`@capacitor/preferences`. They are imported statically by the mobile shell —
`src/mobile/shellBootstrap.ts` and `src/mobile/shellUpdate.ts` — and
`buildShellBootstrap` bundles that entry with `Bun.build`, marking only
`web-vitals` external. So they must RESOLVE when the shell is bundled, not
merely at run time on a device, and the framework declares what it imports.

`@capacitor/filesystem` is the one that is load-bearing rather than merely
correct. `@absolutejs/devices-capacitor` lists it as an OPTIONAL peer, so
nothing installs it automatically; `browser` and `preferences` are hard
dependencies of that adapter and would arrive transitively even if this package
stopped naming them.

That adapter is also the honest answer to "why does a web-only project install
Capacitor at all". `@absolutejs/devices-capacitor` is a hard dependency of this
framework and depends on `@capacitor/app`, `browser`, `network` and
`preferences`, so those four install for every consumer regardless of what this
package's own manifest says. Shrinking a web-only install means addressing that
adapter, not these three entries — and it carries the same release-path
constraint described below, so it needs the same analysis first.

### Why they are not peers

Being framework dependencies is what puts them in every consuming project's
lockfile without the project asking, and that matters for the release path
rather than for a developer's machine. The generated mobile CI workflow
(`src/mobile/ciWorkflow.ts`) installs with a frozen `bun ci` and never runs
`absolute mobile init`, so a project that had not already declared these
packages could not acquire them during a release: a frozen install cannot add
anything and nothing in the job can repair it. The preview path is the
exception rather than the rule — it runs `mobile init` before bundling, so it
would survive them being peers.

Moving them to `peerDependencies` is therefore a change to make only once the
release pipeline can install them: either that workflow runs `mobile init` (or
an equivalent install) before the shell is bundled, or whatever provisions a
project writes them into its manifest when it enables native delivery.

### Two that were removed, and the reason each was safe

`@capacitor/keyboard` was a hard dependency here. The shell always includes the
`keyboard` capability (`ABSOLUTE_MOBILE_SHELL_DEVICE_CAPABILITIES`) and its
provider module `@absolutejs/devices-capacitor/keyboard` imports the package, so
it does have to resolve when the shell is bundled — but provisioning installs it
on demand: the adapter's capability manifest declares
`packages: ["@capacitor/keyboard@8.0.5"]`, `mobile init` installs a capability's
`requiredPackages`, and `assertNativePackageVersions` then fails loudly if the
tested version is not resolvable. A missing keyboard plugin is a clear error
rather than a silently broken bundle, which is what makes it safe not to carry
here. Nothing else requires it (it is an optional peer of the adapter), so this
is the one removal that reduces a web-only install.

`@capacitor/network` was never imported by anything in `src/`; it appeared only
as a version string the CLI installs into the generated app
(`src/mobile/nativePackages.ts`). Removing it saves a web-only project nothing,
because `@absolutejs/devices-capacitor` depends on it directly — the entry was
simply a dependency this package did not use.

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

# Remote iOS development

AbsoluteJS can use a developer-owned Mac as the iOS execution host while Bun,
the application server, source editing, and web HMR remain on Windows, Linux, or
another Mac. The remote host is a normal user-controlled Mac; this workflow does
not require the AbsoluteJS hosted platform.

## Boundary

Apple's Xcode, iOS Simulator, `xcodebuild`, and `simctl` still run on macOS.
AbsoluteJS owns the connection and development lifecycle around those tools:

```text
developer computer                         paired Mac
------------------                         ----------
source editor + Bun dev server             Xcode + iOS Simulator/device
page/CSS compilation             SSH       Capacitor or Expo CNG project
HMR + Expo Metro               <------>     native build/install/launch
terminal logs and timings                  persistent native caches
```

The SSH connection creates a reverse loopback tunnel for Bun. Expo sessions
create a second independently bound tunnel for the developer computer's Metro
server. The application inside
the remote Simulator loads `localhost:<dev-port>`, but SSH carries that traffic
back to the developer computer. AbsoluteJS page and CSS updates therefore keep
the normal HMR path and do not synchronize or rebuild the native project.

For an explicitly selected physical device, the agent exposes raw TCP relays
only on the Remote Mac's LAN ports and connects them to separately bound SSH
loopback tunnels. Expo uses one relay for Bun and another for Metro. TLS,
WebSocket HMR, Fast Refresh, and application traffic remain end-to-end
between the device and the developer's AbsoluteJS server; the relay does not
terminate or inspect them.

## Mac prerequisites

On the Mac:

1. Install and select full Xcode, accept its license, and install an iOS
   Simulator runtime.
2. Install Bun. `~/.bun/bin/bun` is discovered even when the non-interactive SSH
   environment does not add it to `PATH`.
3. Enable **Remote Login** in macOS **System Settings → General → Sharing**.
4. Allow SSH public-key authentication and TCP forwarding.

For a physical iPhone or iPad, also pair it in Xcode Device Hub, enable Developer
Mode, keep it on the Remote Mac's LAN, and configure the generated workspace's
Development Team and automatic signing once.

From the developer computer, establish and verify SSH first:

```bash
ssh builder@my-mac.local
```

Confirm the displayed host-key fingerprint against the Mac before accepting it.
AbsoluteJS uses non-interactive key authentication during development and never
stores an SSH password or private key.

## Pairing

```bash
absolute mobile pair mac personal-mac builder@my-mac.local
```

An SSH config alias works too:

```sshconfig
Host ios-builder
  HostName my-mac.example
  User builder
  IdentityFile ~/.ssh/absolute-ios
```

```bash
absolute mobile pair mac personal-mac ios-builder
```

Use a non-default SSH port or remote workspace when required:

```bash
absolute mobile pair mac personal-mac builder@my-mac.local \
  --port 2222 \
  --workspace /Users/builder/AbsoluteJS
```

Pairing verifies Darwin, Bun, and Xcode. Profiles contain only connection
metadata and are written with user-only permissions under
`~/.absolutejs/mobile/remote-macs.json`. The most recently paired profile is the
default. `ABSOLUTE_IOS_REMOTE=<profile>` selects another profile without changing
application configuration.

Inspect or remove profiles with:

```bash
absolute mobile remotes
absolute mobile remotes --json
absolute mobile remotes inspect personal-mac
absolute mobile remotes inspect personal-mac --json
absolute mobile doctor ios --remote personal-mac
absolute mobile unpair mac personal-mac
```

Unpairing removes only local connection metadata. It deliberately does not
delete a remote workspace.

The inspection reports workspace bytes, reusable project and agent caches, and
active release leases without returning source paths or lease-owner metadata.
After an interrupted build, safely remove abandoned staging directories older
than one day with:

```bash
absolute mobile remotes clean personal-mac --yes
```

Cleanup retains current project snapshots, dependency/native caches, immutable
releases, content-addressed agents, and active leases. It is not required for
recovery; it exists to reclaim incomplete temporary work after the cause has
been investigated.

## Development

For Capacitor, the application must have an initialized, committed iOS project:

```bash
absolute mobile init
bun dev
```

Expo uses its generated CNG shell and requires no committed native directory:

```bash
# absolute.config.ts contains mobile.engine: 'expo'
bun dev
```

On a non-macOS host, `bun dev` automatically selects the default paired Mac. On
first use it:

1. Builds or locates the self-contained AbsoluteJS remote agent.
2. Uploads it into a content-addressed directory under the paired workspace.
3. Verifies its SHA-256 digest before execution.
4. Synchronizes an atomic project snapshot, excluding `.git`, `node_modules`,
   local build output, local `.absolutejs` state, environment files, private
   signing keys/profiles, and Android keystores.
5. Preserves the Mac's `node_modules`, `.absolutejs` generated state,
   DerivedData, native fingerprint, and installed-app caches across snapshots.
6. Runs a frozen Bun dependency installation for the remote project.
7. Starts the iOS controller and reverse HMR tunnel over one SSH connection.
   Expo regenerates its Mac-local CNG shell, installs its pinned SDK only when
   absent, and adds the Metro tunnel while keeping Metro beside the source
   editor on the developer computer.

The remote agent is supplied by the local AbsoluteJS installation. It never
discovers or executes AbsoluteJS through the application's
`node_modules/.bin`. The application dependency tree is used only for its own
Capacitor packages and plugins.

Native Swift, Xcode project, entitlement, plugin, Capacitor configuration,
package, or lockfile changes trigger another atomic synchronization and native
rebuild. Expo CNG output is disposable and is regenerated from AbsoluteJS
configuration; it must not be edited remotely. Page, component, CSS, ordinary
public-asset, and Expo native-route edits stay on local AbsoluteJS HMR or Metro
Fast Refresh and do not synchronize the whole project.

Select a physical device from the developer computer with the same public CLI:

```bash
bunx absolute dev --ios-device DEVICE_IDENTIFIER
```

AbsoluteJS discovers the Remote Mac's LAN address over the paired SSH profile,
adds that identity to the existing `dev.https` certificate when required, and
passes only the public CA to the remote agent. The agent prints a random,
session-only HTTP certificate URL reachable by the device. Open it in device
Safari, approve the profile, and enable it under **Settings > General > About >
Certificate Trust Settings**. The main HTTPS/HMR connection uses the LAN relay;
the CA private key and dev server remain on the developer computer. Ctrl-C closes
the certificate endpoint, relay, agent, and SSH tunnel.

The normal interactive development commands continue to work:

- `d` / `device` reports the remote Simulator or physical-device identifier and
  state.
- `relaunch` terminates and launches the installed iOS application again.
- Ctrl-C closes native logs, restores the temporary development projection, and
  removes the SSH tunnel. It leaves the Simulator and native caches warm.

## Production builds and TestFlight

Run release commands from the application root—the directory containing the
application's `package.json`, lockfile, and `absolute.config.ts`—not from the
AbsoluteJS framework repository and not from the Remote Mac workspace:

```bash
# Windows, Linux, or macOS; explicit profile
bunx absolute mobile build ios src/backend/server.ts \
  --config absolute.config.ts \
  --remote personal-mac

# Uses the default paired Mac on Windows/Linux
bunx absolute mobile publish ios src/backend/server.ts \
  --config absolute.config.ts \
  --registry mobile.release.ts \
  --channel internal \
  --testflight-group 'Internal Testers'
```

Before the first signed build, open the generated workspace on the paired Mac,
select the Apple Development Team, enable automatic signing, and confirm that
the paired macOS user can access the required signing identity and provisioning
profile. `ABSOLUTE_IOS_DEVELOPMENT_TEAM` may be set on the developer computer;
the ten-character, non-secret team identifier is sent to Xcode on the Mac.

The release path is intentionally split across the trust boundary:

```text
developer computer                         paired Mac
------------------                         ----------
build AbsoluteJS web/mobile bundle   SSH   atomic source + bundle snapshot
load release registry/adapters       --->  regenerate Capacitor/Expo native UI
allocate stable Apple build number   <-->  fingerprint native project
retain App Store API credentials           archive + sign + export with Xcode
verify IPA SHA-256 and byte length    <---  immutable IPA + release metadata
publish registry/TestFlight                retain signing keys in Keychain
```

The content-addressed AbsoluteJS agent performs native preparation, release
doctor validation, Xcode archive, signature verification, and export. It does
not invoke a project-local AbsoluteJS executable. The generated IPA is streamed
back to a local staging file, re-hashed, checked against strict protocol
metadata, and only then atomically installed under
`.absolutejs/mobile/releases/ios/amobile_ios_<sha256>/`. Publication continues
locally through the normal `mobile.release.ts` adapter, so App Store Connect API
keys and release-registry credentials are never sent to the Mac. Apple signing
certificates and provisioning material remain in the paired Mac's Keychain and
Xcode configuration.

Before synchronizing release inputs, AbsoluteJS takes an atomic project-scoped
lease on the Mac. A second build for the same local-project identity fails fast
with non-secret owner/time diagnostics instead of racing source snapshots,
native generation, or Xcode. The owner refreshes the lease every 15 seconds. If
the initiating computer sleeps, crashes, or loses SSH long enough to miss the
two-minute expiry, the next build atomically quarantines and replaces the stale
lease. Every heartbeat and release checks an unguessable owner token, so a late
command from the old build cannot touch a newer lease.

Ctrl-C and SIGTERM cancel the local bundle/release operation, terminate SSH and
Xcode through the agent process boundary, await stream shutdown, and release
the lease. Xcode already builds in a unique `.ios-build-*` directory and the IPA
enters both remote and local immutable stores only through atomic promotion, so
an interrupted archive is never mistaken for a completed artifact.

Release logs include `remote-release-lease`, `remote-release-sync`, `remote-release-prepare`,
`remote-release-xcode`, and `remote-release-download` timings. Telemetry records
only those phase durations, engine, platform, and `remote-mac` provider; it does
not record the profile name, SSH destination, paths, app identity, artifact
hash, build number, or credentials.

## Security properties

- OpenSSH owns authentication, host-key pinning, SSH agent use, and private keys.
- Profile input rejects command-line options and shell metacharacters.
- Remote commands quote every application-controlled path.
- The remote agent is protocol-versioned, content-addressed, and SHA-256 verified.
- Project snapshots are isolated by a non-reversible project identity rather
  than exposing the developer's local path.
- Project-scoped leases serialize releases, recover stale owners, and require
  the current random token for heartbeat or cleanup.
- Signing certificates and Keychain items stay on the Mac.
- App Store Connect, release-registry, and PaaS credentials stay on the
  developer computer; only the allocated integer build number crosses SSH.
- Physical-device traffic is relayed as opaque TCP; the Remote Mac receives only
  the public development CA and never the CA private key.
- Native logs use the existing AbsoluteJS credential and token redaction.
- Telemetry reports provider/platform/timings and cache outcomes, never the SSH
  destination, account name, workspace, source paths, app identity, or device
  UDID.

## Current display options

AbsoluteJS runs and observes the real remote Simulator, and its protocol carries
screenshots for conformance and failure artifacts. For direct mouse/touch
interaction during this first protocol release, connect to the user-owned Mac
with an SSH-tunneled VNC or trusted remote-desktop product. A browser-streamed,
tenant-isolated Simulator viewer is a separate layer and is intentionally not
coupled to this bring-your-own-Mac protocol.

## Troubleshooting

- **Permission denied:** configure an SSH key and verify `ssh <destination>`
  succeeds without a password prompt.
- **Host key verification failed:** inspect the actual Mac fingerprint and repair
  the corresponding local `known_hosts` entry; do not disable verification.
- **Remote forwarding failed:** enable TCP forwarding in the Mac's SSH service or
  choose a development port not already reserved on the Mac.
- **Remote Mac LAN discovery failed:** connect the Mac to the device's network or
  configure a working `en0`/`en1` network interface before starting physical mode.
- **Device unavailable:** unlock and pair it in Xcode Device Hub, trust the Mac,
  enable Developer Mode, and rerun `xcrun devicectl list devices` on the Mac.
- **Bun missing:** install Bun for the paired user at `~/.bun/bin/bun` or expose it
  in the non-interactive SSH environment.
- **Xcode missing:** install full Xcode, run `xcode-select`, accept the license,
  and install a Simulator runtime.
- **Frozen install failed:** commit the application's current Bun lockfile and
  make every referenced dependency reachable from the Mac.
- **iOS project missing:** run `absolute mobile init` and commit the generated
  source-owned native project before starting remote development.
- **Remote Expo dependency install failed:** verify the paired Mac can reach the
  package registry. AbsoluteJS installs the pinned generated-shell dependencies
  on first use and reuses that cache afterward.
- **Signed release fails before archive:** open the generated Xcode workspace as
  the paired macOS user, choose the correct team, enable automatic signing, and
  confirm the distribution identity and provisioning profile are accessible.
- **No Remote Mac selected on Windows/Linux:** pair a Mac, select it with
  `--remote <name>`, set `ABSOLUTE_IOS_REMOTE=<name>`, or pair it last to make it
  the default.
- **Retrieved IPA is rejected:** do not copy artifacts manually. Resolve stale
  or modified remote release state and rerun the command; AbsoluteJS refuses an
  IPA whose local byte count or SHA-256 differs from `release.json`.
- **Another build owns the release workspace:** allow the named build to finish.
  If its computer crashed or disconnected, wait two minutes and rerun; stale
  recovery is automatic. Use `absolute mobile remotes inspect <name>` to confirm
  whether any release lease remains. Do not manually delete an active lease.
- **Interrupted build left temporary data:** rerun the release first. If it no
  longer needs the old staging data, run
  `absolute mobile remotes clean <name> --yes`; the command only removes
  abandoned staging directories older than one day.
- **Expo app opens but Fast Refresh cannot connect:** verify both reverse
  forwards are allowed. A Remote Expo session needs the Bun port and its printed
  Metro port; physical devices additionally need both Remote Mac LAN ports.

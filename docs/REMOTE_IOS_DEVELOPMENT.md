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
absolute mobile doctor ios --remote personal-mac
absolute mobile unpair mac personal-mac
```

Unpairing removes only local connection metadata. It deliberately does not
delete a remote workspace.

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
   local build output, and local `.absolutejs` state.
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

## Security properties

- OpenSSH owns authentication, host-key pinning, SSH agent use, and private keys.
- Profile input rejects command-line options and shell metacharacters.
- Remote commands quote every application-controlled path.
- The remote agent is protocol-versioned, content-addressed, and SHA-256 verified.
- Project snapshots are isolated by a non-reversible project identity rather
  than exposing the developer's local path.
- Signing certificates and Keychain items stay on the Mac.
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
- **Expo app opens but Fast Refresh cannot connect:** verify both reverse
  forwards are allowed. A Remote Expo session needs the Bun port and its printed
  Metro port; physical devices additionally need both Remote Mac LAN ports.

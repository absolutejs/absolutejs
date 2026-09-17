# Mobile release certification

AbsoluteJS release certification turns installed-app evidence into one local,
machine-readable gate for an exact immutable native release. It does not build,
sign, upload, or promote an application, and it never upgrades weak evidence to
a stronger Apple claim.

Run every command from the application repository root.

## 1. Produce installed-release evidence

Always pass `--report`. The certification command consumes the generated
directory or its `report.json` file.

```sh
# Android: exact AAB installed through Bundletool, launched offline twice
bunx absolute mobile test android \
  --release .absolutejs/mobile/releases/android/<release-id> \
  --report .absolutejs/mobile/test-reports/android-release \
  --yes

# iOS Simulator: source-equivalent Release build
bunx absolute mobile test ios \
  --release .absolutejs/mobile/releases/ios/<release-id> \
  --report .absolutejs/mobile/test-reports/ios-simulator \
  --remote my-mac

# iOS registered device: companion IPA from the App Store archive
bunx absolute mobile test ios \
  --release .absolutejs/mobile/releases/ios/<release-id> \
  --report .absolutejs/mobile/test-reports/ios-device \
  --remote my-mac \
  --device '<device>' \
  --yes

# iOS TestFlight: exact Apple-processed version/build already installed
bunx absolute mobile test ios \
  --release .absolutejs/mobile/releases/ios/<release-id> \
  --report .absolutejs/mobile/test-reports/ios-testflight \
  --remote my-mac \
  --device '<device>' \
  --testflight \
  --yes
```

The report can retain unfinished manual checklist rows. Certification ignores
their editable prose and independently requires the relevant automated
installed-release checks, successful run contract, provider, app ID, release ID,
artifact SHA-256, byte count, signing state, and platform-specific evidence
combination.

## 2. Create a certification

Android has one fixed `installed` requirement. It proves the generated APK set
from the exact signed AAB rendered its embedded bundle with the emulator's Wi-Fi
and mobile-data transports disabled, then survived a force-stop and relaunch.

```sh
bunx absolute mobile certify \
  .absolutejs/mobile/releases/android/<release-id> \
  --evidence .absolutejs/mobile/test-reports/android-release \
  --require installed
```

iOS requirements are ordered. `store` satisfies `device` and `simulator` policy;
`device` satisfies `simulator`; Simulator evidence never satisfies either
physical tier.

```sh
# Source-equivalent only
bunx absolute mobile certify \
  .absolutejs/mobile/releases/ios/<release-id> \
  --evidence .absolutejs/mobile/test-reports/ios-simulator \
  --require simulator

# Archive-equivalent physical-device minimum
bunx absolute mobile certify \
  .absolutejs/mobile/releases/ios/<release-id> \
  --evidence .absolutejs/mobile/test-reports/ios-device \
  --require device

# Store-delivered TestFlight minimum; multiple reports may be retained
bunx absolute mobile certify \
  .absolutejs/mobile/releases/ios/<release-id> \
  --evidence .absolutejs/mobile/test-reports/ios-simulator \
  --evidence .absolutejs/mobile/test-reports/ios-device \
  --evidence .absolutejs/mobile/test-reports/ios-testflight \
  --require store
```

The default is `installed` for Android and `simulator` for iOS. Certifications
are written atomically beneath:

```text
.absolutejs/mobile/certifications/<platform>/<release-id>/<certification-id>/
  certification.json
  certification.md
```

`certification-id` is the SHA-256 of a canonical certification body. An existing
directory must contain byte-identical JSON and Markdown or the command fails.
For identical reports, release, and policy, the latest evidence timestamp is
used as the certification timestamp so repeating the command produces the same
ID and bytes.
The output binds the artifact digest and bytes, release ID, signed state, native
runtime fingerprint, embedded app build, engine, app ID, and allocated native
version/build. It contains report digests and bounded evidence facts, never
report paths, target identifiers, SSH destinations, credentials, application
data, or page contents.

This is content-addressed integrity and policy evidence, not an identity
signature. Use CI artifact provenance or your organization's signing system
when the identity of the certifying runner must also be attested.

## 3. Verify before promotion

Verification re-hashes the native artifact through the normal release reader,
checks the certification content digest, re-evaluates its evidence semantics,
and compares the complete release identity. Any binary, embedded bundle,
runtime fingerprint, signing state, version, or build-number change invalidates
the certification.

```sh
bunx absolute mobile certify \
  .absolutejs/mobile/releases/ios/<release-id> \
  --verify .absolutejs/mobile/certifications/ios/<release-id>/<certification-id> \
  --require store
```

The command exits nonzero on any mismatch. `mobile publish` performs this
verification itself and promotes the existing tested artifact:

```sh
bunx absolute mobile publish android \
  --release "$RELEASE_DIRECTORY" \
  --certification "$CERTIFICATION_DIRECTORY" \
  --channel production \
  --play-track production \
  --registry mobile.release.ts
```

This path never rebuilds. It validates the configured channel/store policy,
the certification content address and semantics, and the full immutable release
identity. It also requires the registry response to contain a matching retained
certification receipt. By default, production channels require `installed`
Android or `store` iOS evidence, and the production Google Play track requires
`installed` evidence. Applications can configure explicit per-channel and
per-track policies under `mobile.release.certification`.

Upload `mobile-certification.json`, the immutable certification directory, and
the release directory as protected CI artifacts. Run this verification step
with the provider-neutral registry receipt and store promotion record. Initial
TestFlight upload cannot require store-delivered
evidence from a build that Apple has not processed yet; require Simulator or
registered-device evidence for that transition, then require `store` before a
later production promotion.

Telemetry contains only operation mode, platform, engine, requested policy,
resulting strength, evidence count, success, and duration. Certification files
remain local unless the developer or CI workflow uploads them.

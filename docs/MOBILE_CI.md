# AbsoluteJS mobile CI and store releases

Status: generated GitHub Actions workflow for Capacitor Android/iOS and Expo
Android. Expo iOS release automation remains a separate checkpoint.

Run this command from the application root—the directory containing
`package.json`, the server entry, and `absolute.config.ts`:

```sh
bunx absolute mobile ci github server.ts
```

It creates `.github/workflows/absolute-mobile.yml`. Generation is deterministic
and idempotent; AbsoluteJS refuses to replace a different file unless `--force`
is explicit.

For `mobile.engine: 'expo'`, the generator emits Android validation, signing,
release-doctor, attestation, retention, registry, and optional Google Play jobs.
If the config also lists iOS, iOS is omitted rather than generating a job that
cannot yet satisfy the Expo iOS release contract. An Expo iOS-only config is
rejected with an actionable error.

The generated workflow has two trust levels:

1. Pull requests install the exact Bun lockfile, produce the production mobile
   bundle, validate every embedded page hash and capability declaration, and
   upload a redacted inspection report. Pull-request code never receives signing
   or store credentials.
2. Manual workflow dispatch can build Android, iOS, or both. Those jobs use the
   protected `absolute-mobile-release` GitHub environment, run the complete
   platform-scoped release doctor, optionally attest the native artifact, and
   upload the immutable release directory.

Workflow-level concurrency serializes releases for the repository and never
cancels a running release.

## Generate build-only or publishing workflows

The default is signed build-only CI:

```sh
bunx absolute mobile ci github server.ts
```

Include the existing `mobile.release.ts` registry and optional Google Play or
TestFlight controls with:

```sh
bunx absolute mobile ci github server.ts --publish
```

Options:

```text
--config path        Use a non-default AbsoluteJS config.
--registry path      Use a non-default native release publisher module.
--secret-env NAME    Expose an additional GitHub environment secret to the
                     release module. Repeat for multiple names.
--output path        Write another .yml/.yaml file under .github/workflows.
--force              Replace a different generated workflow.
--json               Print a redacted machine-readable generation result.
```

`--secret-env` accepts only uppercase environment-variable identifiers and
rejects GitHub, runner, Actions, and AbsoluteJS-reserved names. Values are never
read or copied during generation; only `${{ secrets.NAME }}` references enter
the workflow.

## Configure the protected GitHub environment

Open **Settings > Environments**, create `absolute-mobile-release`, require an
appropriate release reviewer, and restrict deployment branches. Store signing
and provider credentials in that environment rather than repository variables.

The generator prints the exact required names. Android uses:

| Secret | Purpose |
| --- | --- |
| `ABSOLUTE_ANDROID_KEYSTORE_BASE64` | Base64-encoded Android upload keystore |
| `ABSOLUTE_ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `ABSOLUTE_ANDROID_KEY_ALIAS` | Upload-key alias |
| `ABSOLUTE_ANDROID_KEY_PASSWORD` | Upload-key password |
| `ABSOLUTE_GOOGLE_CREDENTIALS_BASE64` | Google service-account JSON; needed only for a Play track |

The workflow decodes the keystore into the runner's temporary directory.
AbsoluteJS builds the AAB and, if the source-owned Gradle project did not sign
it, signs it with `jarsigner`. Passwords use `-storepass:env` and
`-keypass:env`; they never become command arguments. The AAB must pass signature
verification before retention or publication. Custom Gradle signing remains
supported.

iOS uses:

| Secret | Purpose |
| --- | --- |
| `ABSOLUTE_IOS_CERTIFICATE_BASE64` | Base64-encoded Apple Distribution `.p12` |
| `ABSOLUTE_IOS_CERTIFICATE_PASSWORD` | `.p12` password |
| `ABSOLUTE_IOS_PROVISIONING_PROFILE_BASE64` | Base64-encoded App Store provisioning profile |
| `ABSOLUTE_IOS_KEYCHAIN_PASSWORD` | Ephemeral CI keychain password |
| `ABSOLUTE_IOS_DEVELOPMENT_TEAM` | Ten-character Apple development team ID |
| `APP_STORE_CONNECT_ISSUER_ID` | App Store Connect team API issuer |
| `APP_STORE_CONNECT_KEY_ID` | App Store Connect API key ID |
| `APP_STORE_CONNECT_PRIVATE_KEY_BASE64` | Base64 App Store Connect `.p8`; needed only for TestFlight |

The iOS job imports the certificate into a temporary keychain, installs the
profile, supplies the team to Xcode, and deletes all temporary credential files
in an `always()` cleanup step. GitHub-hosted macOS runners are ephemeral. A
self-hosted or bring-your-own Mac must also guarantee runner isolation and host
cleanup.

Application-specific registry credentials are declared explicitly:

```sh
bunx absolute mobile ci github server.ts \
  --publish \
  --secret-env RELEASE_BUCKET \
  --secret-env RELEASE_REGION
```

The `mobile.release.ts` module reads them normally through `process.env`.

## Run a release

Open **Actions > AbsoluteJS Mobile > Run workflow**, then choose a platform or
both.

- Leave **Publish** disabled to produce signed AAB/IPA artifacts only.
- Enable **Attest** to request GitHub artifact provenance.
- Enable **Publish** to invoke the configured native release registry.
- Select `registry-only` to retain Android without Google Play.
- Select a Play track to use the resumable Play publisher.
- Enter a TestFlight group to upload iOS. External beta review remains a
  separate explicit checkbox.

Workflow inputs are passed as quoted Bash-array elements, never evaluated as
shell source. Each native job reruns the redacted release doctor after building
and uploads `compliance.json` separately from the binary.

## Rotation, failures, and retries

- Never commit decoded keys, profiles, `.p8` files, or credential JSON.
- Rotate a GitHub environment secret in place; do not regenerate the workflow.
- Preserve the release registry receipt store. It makes interrupted Play and App
  Store Connect operations safely resumable.
- Rerun the same commit and inputs after infrastructure interruption. Build
  identity and provider receipts determine whether work is reused.
- Fix a release-doctor failure in source/config and create a new run; never edit
  copied native output.

The workflow follows GitHub's protected-environment and concurrency model, Bun's
frozen `bun ci` installation, immutable artifact uploads, and optional artifact
attestations. See the official documentation for
[deployment environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments),
[Apple signing](https://docs.github.com/en/actions/how-tos/deploy/deploy-to-third-party-platforms/sign-xcode-applications),
[artifact attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations),
and [`bun ci`](https://bun.sh/docs/pm/cli/install).

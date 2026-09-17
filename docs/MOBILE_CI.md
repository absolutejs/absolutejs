# AbsoluteJS mobile CI and store releases

Status: generated GitHub Actions workflow for Capacitor and Expo on Android and
iOS.

Run this command from the application root—the directory containing
`package.json`, the server entry, and `absolute.config.ts`:

```sh
bunx absolute mobile ci github server.ts
```

It creates `.github/workflows/absolute-mobile.yml`. Generation is deterministic
and idempotent; AbsoluteJS refuses to replace a different file unless `--force`
is explicit.

For `mobile.engine: 'expo'`, the generator emits the same configured-platform
validation, signing, release-doctor, attestation, retention, registry, Google
Play, and TestFlight jobs. Each job first regenerates its disposable native
project through clean production CNG; application authors do not edit or commit
the generated Android/iOS directories.

The generated workflow has two trust levels:

1. Pull requests install the exact Bun lockfile, produce the production mobile
   bundle, validate every embedded page hash and capability declaration, and
   upload a redacted inspection report. Pull-request code never receives signing
   or store credentials.
2. Manual workflow dispatch can build Android, iOS, or both. Those jobs use the
   protected `absolute-mobile-release` GitHub environment, run the complete
   platform-scoped release doctor, optionally attest the native artifact, and
   upload the immutable release directory. Publishing mode also acceptance-tests
   that exact directory, creates a certification, and republishes the same bytes
   through the registry/store gate.
3. A later protected promotion can restore an Android or iOS release artifact
   from an exact prior workflow run, import stronger partner certification,
   re-hash the release without rebuilding it, bind the certification to the
   current GitHub OIDC identity with a portable Sigstore bundle, publish it,
   and upload the final registry/store receipt.

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
- Enable **Publish** to test, certify, and invoke the configured native release
  registry with the existing immutable artifact.
- Select `registry-only` to retain Android without Google Play.
- Select a Play track to use the resumable Play publisher.
- Enter a TestFlight group to upload iOS. External beta review remains a
  separate explicit checkbox.

Android publishing provisions the managed emulator/toolchain, installs the AAB
through Bundletool, proves an offline relaunch, and creates `installed`
certification. iOS publishing runs source-equivalent Simulator release
acceptance and creates `simulator` certification before the initial TestFlight
upload. Do not select the production channel for that initial iOS transition
when it retains the default `store` policy; install the Apple-processed build
from TestFlight, create `store` certification, then promote the retained IPA in
a later protected run.

Workflow inputs are passed as quoted Bash-array elements, never evaluated as
shell source. Each native job reruns the redacted release doctor after building
and uploads `compliance.json` separately from the binary.

## Resume a tested release without rebuilding

The generated publishing workflow supports a second `promote` operation. The
recommended interface is the CLI rather than manually pasting workflow inputs.
Run this from the application root after `gh auth status` succeeds:

```sh
bunx absolute mobile ci promote ios \
  --run-id 1234567890 \
  --certification .absolutejs/mobile/certifications/ios/<release-id>/<certification-id> \
  --channel production
```

For Android, use `promote android` and optionally add `--play-track
production`. For iOS TestFlight distribution, add `--testflight-group GROUP`
and, only when intended, `--testflight-submit-review`. Use `--ref BRANCH` when
the generated workflow is not on the repository's default branch.

The run ID is the GitHub Actions run that produced the retained
`absolute-mobile-android` or `absolute-mobile-ios` artifact. Artifacts expire
after 14 days by default, so promote or preserve them before that boundary. The
CLI validates that the certification belongs to the configured application and
platform, sends only its bounded non-secret JSON to GitHub, and dispatches the
protected workflow. The workflow then:

1. downloads the named artifact from that exact source run;
2. requires exactly one immutable release directory and re-hashes it;
3. verifies the imported certification against that restored release;
4. signs the exact `certification.json` bytes with short-lived GitHub OIDC via
   pinned Cosign and immediately verifies the signature;
5. sends the portable Sigstore bundle and complete workflow identity to the
   trusted registry verifier;
6. publishes the existing AAB/IPA without Gradle, Xcode, or a Mac runner; and
7. uploads `promotion-receipt.json`, the certification, Sigstore bundle, and
   verification envelope as a 90-day audit artifact.

The protected `absolute-mobile-release` environment still controls approval and
store credentials. A promotion cannot select `all`, omit the source run or
certification, or run without a channel/store target.

## Inspect and independently audit a promotion

Every command in this section runs from the application root. The promotion
command prints the new GitHub Actions run URL; copy its numeric run ID. Inspect
the current state without opening the Actions UI:

```sh
bunx absolute mobile ci status --run-id <promotion-run-id>
```

Wait for completion and return a failing exit status when the workflow fails:

```sh
bunx absolute mobile ci status --run-id <promotion-run-id> --watch
```

Use `--json` for automation and `--repo owner/name` when the current checkout
does not identify the target repository.

After a successful promotion, download and independently replay its retained
evidence:

```sh
bunx absolute mobile ci audit --run-id <promotion-run-id>
```

The audit discovers the source build run recorded by the promotion, downloads
the exact retained AAB or IPA, re-hashes and validates its immutable release
metadata, re-verifies the installed-app certification, checks the portable
Sigstore bundle against its GitHub workflow identity, and binds the publication
receipt to the same release and certification. This is verification of the
downloaded bytes; it does not trust the workflow's success badge as proof.

The default output is
`.absolutejs/mobile-ci/audits/<promotion-run-id>/`. It contains the downloaded
source release and promotion evidence plus sanitized `audit.json` and
`audit.md` reports. The command refuses to replace an existing audit directory;
pass `--outdir relative/path` to choose another project-local destination.
Install the same pinned Cosign release used by generated CI (`v3.1.2`) before
running the audit. The verification path never needs signing or store
credentials.

New format-3 workflows retain source artifacts for 14 days and promotion audit
artifacts for 90 days. Run the audit before the source artifact expires, or
preserve it under your own retention policy. A promotion created by an older
workflow does not carry its source-run context; supply it explicitly:

```sh
bunx absolute mobile ci audit \
  --run-id <promotion-run-id> \
  --source-run-id <source-build-run-id>
```

For support or compliance review, send `audit.md` or `audit.json`; neither
contains credentials, device identifiers, local absolute paths, application
data, nor GitHub tokens. Keep the accompanying evidence directory when the
reviewer must reproduce the cryptographic checks.

## Gate promotion on release certification

Build completion proves that the immutable release was produced correctly; it
does not prove that the same release worked after installation. After the
Android installation check or the appropriate iOS Simulator, registered-device,
and TestFlight checks, create a content-addressed certification from the release
directory and returned acceptance reports:

```sh
bunx absolute mobile certify .absolutejs/mobile/releases/<platform>/<release-id> \
  --evidence .absolutejs/mobile/acceptance/<report-one> \
  --evidence .absolutejs/mobile/acceptance/<report-two> \
  --require store \
  --json
```

Use `--require installed` for Android. For iOS, use `simulator`, `device`, or
`store` to express the promotion boundary. Store proof includes Apple-processed,
TestFlight-delivered evidence, so it necessarily happens after the workflow has
uploaded the first candidate; require it when promoting that already-tested
release onward, not before its initial TestFlight upload.

Transfer the generated certification back to the release owner, then dispatch a
protected follow-up run for the existing release—not a rebuild:

```sh
bunx absolute mobile ci promote ios \
  --run-id <source-build-run-id> \
  --certification .absolutejs/mobile/certifications/ios/<release-id>/<certification-id> \
  --channel production
```

Use the same shape with `publish android`; add `--play-track production` when
shipping through Google Play. AbsoluteJS defaults the `production` channel to
`installed` Android evidence and `store` iOS evidence, and defaults the Play
`production` track to `installed`. Customize or explicitly disable targets with
`mobile.release.certification.channels` and
`mobile.release.certification.googlePlayTracks`.

Publication re-verifies the certification and complete release identity before
calling the registry. The registry must return a receipt proving that it
retained the same certification, release, requirement, and evidence strength.
Certification creation validates the automated acceptance checks and stores the
exact report digests. Later verification re-reads the immutable release,
validates the certification digest and evidence semantics, matches the artifact
digest and embedded runtime identity, and exits nonzero if the certification,
release, or requested policy differs. Preserve the original reports beside the
certification when an auditor must re-run report validation.

The certification digest detects content changes; GitHub OIDC supplies actor
and workflow identity only after the server verifies its portable Sigstore
bundle. The generated workflow uses `@absolutejs/attest`, but the application
registry must opt into trusted verification as shown below.

```ts
import { createNativeReleaseRegistry } from '@absolutejs/deploy/native-release';
import {
  verifyPortableBlobBundle,
  type CommandRunner
} from '@absolutejs/attest';

const runner: CommandRunner = async (command) => {
  const child = Bun.spawn([...command], { stderr: 'pipe', stdout: 'pipe' });
  const [exitCode, stderr, stdout] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text()
  ]);
  if (exitCode !== 0) throw new Error(stderr || `Cosign exited ${exitCode}`);
  return { stderr, stdout };
};

export default createNativeReleaseRegistry({
  store,
  requireTrustedCertification: true,
  certificationVerifier: async ({ certification, metadata, verification }) => {
    if (!verification) throw new Error('Portable verification is required');
    const { identity } = verification;
    if (
      identity.repository !== 'YOUR_ORG/YOUR_REPOSITORY' ||
      identity.workflowPath !== '.github/workflows/absolute-mobile.yml' ||
      identity.ref !== 'refs/heads/main'
    ) throw new Error('Untrusted certification workflow identity');
    const verified = await verifyPortableBlobBundle({
      artifact: `${JSON.stringify(certification, null, 2)}\n`,
      bundle: verification.bundle,
      identity,
      runner
    });
    return {
      issuer: identity.issuer,
      subject: metadata.releaseId,
      verifiedAt: new Date().toISOString(),
      verificationId: `sigstore:${verified.bundleSha256}`
    };
  }
});
```

Install `@absolutejs/attest` in the application that owns this registry and
install pinned Cosign in its trusted server image. The verifier, not the mobile
client or workflow input, enforces the allowed repository, workflow, and ref;
Cosign then verifies the issuer, exact workflow identity, full source SHA,
signature, certificate chain, and transparency evidence. See [mobile release
certification](MOBILE_RELEASE_CERTIFICATION.md) for the complete evidence
hierarchy and partner handoff.

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

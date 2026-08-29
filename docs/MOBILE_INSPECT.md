# AbsoluteJS mobile project inspection

Run mobile inspection from the application root—the directory containing the
application `package.json` and AbsoluteJS config:

```sh
cd /absolute/path/to/the/application
bunx absolute mobile inspect --config absolute.config.ts
```

For a stable report that can be attached to an issue or CI artifact, use JSON:

```sh
bunx absolute mobile inspect --config absolute.config.ts --json
```

`mobile inspect` is read-only. It does not generate a bundle, synchronize
Capacitor, launch an emulator, contact the production server, or modify native
projects.

## What the report proves

The command reports:

- the effective Capacitor engine, target platforms, application identity,
  entry route, production origin, and deep-link surface;
- project-relative bundle and native-project directories;
- the installed and declared versions of the AbsoluteJS and Capacitor runtime
  packages used by the application;
- device capabilities discovered from application source and the exact native
  plugin versions they require;
- whether iOS and Android native projects exist;
- whether the embedded bundle manifest is present and structurally valid;
- embedded build/runtime identity, page and route counts, represented
  frameworks, Auth/Sync presence, and whether the entry resolves locally;
- whether the embedded capability list still matches current source imports;
  and
- the release-doctor check IDs and statuses, without their potentially
  path-bearing detail text.

A `missing` bundle is expected before the first production prepare/build. Build
the application and rerun inspection:

```sh
bunx absolute prepare src/backend/server.ts --config absolute.config.ts
bunx absolute mobile inspect --config absolute.config.ts
```

An `invalid` bundle means inspection found a mismatched app/origin, unsupported
manifest format or framework, missing route/page relationship, missing local
asset, path that escapes the bundle, or an entry route not owned by the embedded
app. Rebuild first; if it remains invalid, include the JSON report in the issue.

`Release projection: not ready` is not the same as an invalid bundle. It means
one or more native release-doctor checks still fail—for example, a platform has
not been initialized or its production-safe Capacitor projection has not been
synchronized. Run the detailed doctor locally for remediation:

```sh
bunx absolute mobile doctor release --config absolute.config.ts
```

For a redacted CI release-compliance artifact, use:

```sh
bunx absolute mobile doctor release --config absolute.config.ts --json
```

Unlike the detailed human doctor, this JSON contains no paths, details, or
remediation text. It reports public app identity/origin/platform facts,
format-versioned check IDs and statuses, aggregate totals, and the manual review
categories that static analysis cannot prove. The enforced boundary and each
manual obligation are documented in
[`MOBILE_SECURITY_THREAT_MODEL.md`](MOBILE_SECURITY_THREAT_MODEL.md).

## Safe sharing boundary

The JSON report intentionally excludes credentials, environment values,
certificate fingerprints, Apple/Google account data, device identifiers,
release-doctor detail strings, and absolute filesystem paths. Application IDs,
package versions, configured public origins, deep-link hosts/schemes, routes,
and project-relative paths are not treated as secrets. Review those public
identifiers before sharing if the project itself is confidential.

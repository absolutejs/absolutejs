# Compiled browser asset retention

Compiled builds give generated browser entrypoints, lazy chunks, styles and vendor
modules a shared content-addressed URL namespace. A change anywhere in that graph
creates a new namespace, including when an otherwise stable vendor filename changes.
An old tab therefore requests its original dependencies instead of mixing releases.

At startup, the executable atomically writes its namespaced browser assets to disk.
Set `ABSOLUTE_ASSET_ARCHIVE_DIR` to a persistent directory shared by releases of the
**same application**, for example `/srv/my-app/client-assets`. The default is
`.absolutejs/client-assets` relative to the process's initial working directory.
Do not put this directory inside a release directory that deployment deletes.
Do not share it across unrelated applications. Read-only or full storage logs a
server-side error and disables historical serving; current embedded assets still work.

Startup cleanup retains the current graph and up to two prior graphs, with a combined
512 MiB budget and seven-day grace period for prior graphs, measured from replacement rather than initial creation. Reactivating a graph during rollback resets its retirement state. Publication exceeding the
budget fails without damaging previously published graphs. Abandoned staging directories
older than seven days are removed. No old server process is required. Missing or expired
versions return an uncached 404, allowing the application's existing explicit update UI
to offer recovery without silently discarding drafts. No request causes an automatic reload.

Only browser assets enter the archive: server entrypoints and their transitive local
modules, source maps, build manifests and unrelated runtime files are excluded.
Unversioned public URLs remain current-release aliases; arbitrary application API URLs,
user strings, and service-worker registration scopes are unchanged.

This protects tabs opened on a build that emits namespaced assets. It cannot restore
files discarded before this feature was installed. Applications still need visible
asset-failure/update recovery for expired releases, offline operation, and earlier tabs.

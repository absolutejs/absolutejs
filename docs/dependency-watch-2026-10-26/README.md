# Root dependency recovery — 0.20.0-beta.153

Hello World installed a newly published dependency after its initial source import
had already failed. The existing development process retained the unresolved-import
compilation overlay until manually restarted. Source-root watching alone did not
cover changes to project-root package.json or lockfiles.

The filesystem regression failed on beta.152 with no manifest notification. The
fix adds one non-recursive root watcher for six dependency control files, keeps
inode/size/mtime/ctime fingerprints, and performs bounded coalesced rename recovery.
It survives atomic replacement, deletion and later creation. Changes enter the
existing content-deduplicated restart pipeline. No recursive node_modules/docs
watching, installed dependency patch or PAAS change was introduced.

Validation on BVM-selected Bun1.4.4+absolute.1:

- Filesystem/restart/scope tests: 6 passed /37 assertions, including atomic saves,
  absent lockfile creation, deletion/recreation and ignored nested data.
- Full unit suite: 1,527 passed /19,395 assertions in269files,128.26seconds.
- Two live dev-server integrations passed: explicit watchDirs behavior and the
  root manifest reaching `[abs:restart]` through the real change pipeline.
- TypeScript check and package build passed. Published client isolation retained
  four optional frameworks behind dynamic chunks. Changelog/API contract passed.
- Focused lint: zero errors; four numeric-delay warnings, two pre-existing and
  two using the same recovery delays in the added watcher.

The first full-suite attempt in the restricted sandbox failed12tests, predominantly
EPERM on loopback listeners. The host-access rerun passed every test. The entire
cross-framework/browser/mobile integration inventory was not run; this change was
qualified with the two targeted server integrations and complete unit suite.

Source/evidence lives in this checkout and upstream Git, not disposable fixtures.
Tests use temporary directories only for data reproducible from committed test code.
The existing trusted-publishing workflow handles the release after its commit is
pushed; publication and consumer adoption must be verified separately.

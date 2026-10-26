# Deleted managed modules — beta154

Hello World removed two helpers after moving them into published geometry0.5.0.
A queued backend HMR event called readFileSync on the now-absent module; ENOENT
escaped apply(), killing the dev process. Browser validation subsequently could
not reach port3077.

Catch filesystem failures at this read boundary and report an ordinary failed HMR
outcome before advancing any module state. The last serving version stays active;
the existing queue accepts later recreation. This does not suppress compilation
errors or claim to make deleted dependencies valid.

Validation with BVM Bun1.4.4+absolute.1:
- Full unit suite:1528 tests /269 files /19401 assertions, zero failures.
- Focused HMR suite after formatting:15 tests /48 assertions, zero failures.
- Six real dev-server integration tests /25 assertions, including deletion,
  continued HTTP serving with the same PID, recreation and successful hot update.
- Package build, TypeScript, published client isolation and changelog/API check pass.
- Focused lint has zero errors and one pre-existing trivial-alias warning.
- Focused formatting passes. Full framework/mobile/browser integration inventory
  was not run; this is complete unit coverage plus targeted live-server coverage.

Formatting after the full unit run changes only layout; the focused regression was
rerun afterward. The new integration also passed afterward. Logs record the scope.
Source and selected receipts are committed upstream; the existing trusted-publish
workflow publishes beta154 on main. Registry publication is verified separately.

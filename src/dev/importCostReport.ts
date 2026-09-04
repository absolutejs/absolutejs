/* Lazy entry for the import-cost report.
 *
 * Built as its own `dist/dev/importCostReport.js` so the analysis — and the
 * `typescript` it needs for the static safety check — is only loaded once the
 * boot has finished and the flag is on. Neither reaches a normal dev boot. */

export { reportImportCost } from './importCost/report';

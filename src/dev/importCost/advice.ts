/* The deferability verdicts, outside a dev boot.
 *
 * `ABSOLUTE_DEV_IMPORT_COST=1` is the measurement, and it is the only thing
 * that can tell a 5ms import from an 800ms one — but it needs a dev boot, and
 * a heavy import lands in a pull request, not in a boot. The *shape* half of
 * that analysis is static (`deferability.ts`) and costs one parse, so it can
 * run wherever the project is already being walked with the TypeScript
 * compiler API. `absolute typecheck` is that place: it runs in CI, which is
 * where a new import is still cheap to move.
 *
 * The rule this file enforces on itself: **never imply a saving.** A
 * `deferrable` verdict says the bindings are only referenced inside function
 * bodies, so moving the import into the function is a mechanical change. It
 * says nothing whatsoever about whether that is worth doing. Every message
 * here says so, and the exit code never moves — see `formatImportAdvice`. */

import { analyzeEntryImports, type EntryImport } from './deferability';

const LINE_WIDTH = 6;

/** The entry's imports that are deferrable *in shape*. Type-only imports are
 *  left out: they are erased and never load, so there is nothing to defer. */
export const deferrableEntryImports = (sourceText: string, fileName: string) =>
	analyzeEntryImports(sourceText, fileName).filter(
		(entry) => entry.verdict === 'deferrable'
	);

/** The listing, printed only when asked for with `--import-advice`. */
export const formatImportAdvice = (
	entries: readonly EntryImport[],
	label: string
) => {
	if (entries.length === 0) {
		return `\x1b[36mi\x1b[0m import advice — ${label}: no top-level import is used only inside functions.`;
	}
	const rows = entries.map(
		(entry) =>
			`  ${String(entry.line).padStart(LINE_WIDTH)}  ${entry.specifier}`
	);

	return [
		`\x1b[36mi\x1b[0m import advice — ${label}`,
		'  Every binding these imports introduce is referenced only inside a',
		'  function body, so moving the import into that function is a',
		'  mechanical change rather than a refactor.',
		'',
		`  ${'line'.padStart(LINE_WIDTH)}  import`,
		...rows,
		'',
		'  This is shape, not cost. Static analysis cannot tell a 5ms import',
		'  from an 800ms one, and on a lot of apps the honest answer is that',
		'  none of these is worth moving. Measure before you move anything:',
		'  ABSOLUTE_DEV_IMPORT_COST=1 on a dev boot reports what each import',
		'  would actually remove from the boot.',
		'',
		'  Advice only — the typecheck exit code is unaffected.'
	].join('\n');
};

/** The one-line form, printed unasked after a passing typecheck.
 *
 * Two lines is the whole budget. `absolute typecheck` earns its keep in CI as
 * a pass/fail gate whose output is read when it fails; a green run that
 * printed a hundred lines of advice would train everyone to stop reading it,
 * and the advice would go with it. So the default is a pointer, and the list
 * is behind the flag it names. */
export const summarizeImportAdvice = (
	entries: readonly EntryImport[],
	label: string
) => {
	if (entries.length === 0) return null;
	const count = entries.length;
	const noun = count === 1 ? 'import is' : 'imports are';

	return [
		`\x1b[36mi\x1b[0m ${count} ${noun} used only inside functions in ${label} — deferrable in shape, not necessarily worth deferring.`,
		'  Run `absolute typecheck --import-advice` to list them, or ABSOLUTE_DEV_IMPORT_COST=1 on a dev boot to measure what they cost.'
	].join('\n');
};

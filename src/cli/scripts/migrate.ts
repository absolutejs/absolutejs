/* `absolute migrate` — the human-facing rendering of the migration engine.
 *
 * All the judgement lives in `src/migrate`, which returns data and never
 * prints. This file only formats. That split is what lets the Studio AI
 * tools hand the same values to a model as JSON instead of scraping text
 * out of a terminal. */

import { applyCodemodPlan } from '../../migrate/apply';
import { CONFIDENT } from '../../migrate/detect';
import { scanProject } from '../../migrate/scan';
import { colors } from '../tuiPrimitives';

const PERCENT = 100;
/** Call sites listed inline before the list is summarised. */
const SHOWN_FILES = 3;

/* `colors` is a map of escape sequences, not helpers. */
const paint = (code: string, text: string) => `${code}${text}${colors.reset}`;
const bold = (text: string) => paint(colors.bold, text);
const dim = (text: string) => paint(colors.dim, text);
const warn = (text: string) => paint(colors.yellow, text);

const stackLabel: Record<string, string> = {
	absolutejs: 'AbsoluteJS',
	astro: 'Astro',
	'create-react-app': 'Create React App',
	nextjs: 'Next.js',
	nuxt: 'Nuxt',
	remix: 'Remix',
	sveltekit: 'SvelteKit',
	unknown: 'not recognised',
	vite: 'Vite'
};

const renderDetection = (plan: ReturnType<typeof scanProject>) => {
	const { detection } = plan;
	const percent = Math.round(detection.confidence * PERCENT);
	const label = stackLabel[detection.kind] ?? detection.kind;
	const lines = [`\n  Stack: ${bold(label)} (${percent}% confident)`];
	for (const item of detection.evidence.slice(0, 4)) {
		lines.push(dim(`    ${item.source} — ${item.detail}`));
	}
	if (detection.alternates.length > 0) {
		lines.push(dim(`    also matched: ${detection.alternates.join(', ')}`));
	}
	// Say so rather than let a thin signal read as a settled answer.
	if (detection.confidence < CONFIDENT && detection.kind !== 'unknown') {
		lines.push(
			warn('    Low confidence — confirm the stack before migrating.')
		);
	}

	return lines.join('\n');
};

const renderSubstitutions = (plan: ReturnType<typeof scanProject>) => {
	const { substitutions } = plan;
	if (substitutions.length === 0) {
		return `\n  ${dim('No first-party substitutions found.')}`;
	}
	const lines = [
		`\n  ${bold(String(substitutions.length))} dependencies have a first-party equivalent:`
	];
	for (const item of substitutions) {
		const where =
			item.usedIn.length > 0
				? `${item.usedIn.length} file${item.usedIn.length === 1 ? '' : 's'}`
				: 'declared, never imported';
		lines.push(`    ${item.from} → ${bold(item.to)} ${dim(`(${where})`)}`);
		lines.push(dim(`      ${item.rationale}`));
	}
	/* Scoped to the dependency table on purpose. The codemods above can be
	 * applied; these cannot — `next-auth` and `@absolutejs/auth` are not the
	 * same API, so rewriting the import would leave code that does not
	 * compile. A swap here is a decision, not an edit. */
	lines.push(
		dim(
			'\n  Dependency swaps are never applied for you: these are different APIs,\n  not renamed imports. Make them yourself, or let Studio propose a diff.'
		)
	);

	return lines.join('\n');
};

const plural = (count: number, word: string) =>
	`${count} ${word}${count === 1 ? '' : 's'}`;

const renderMechanical = (
	plan: ReturnType<typeof scanProject>,
	write: boolean
) => {
	const { mechanical } = plan.codemods;
	if (mechanical.length === 0) return '';
	const moves = mechanical.flatMap((edit) =>
		edit.hits.map((hit) => ({ hit, path: edit.path }))
	);
	const verb = write ? 'Rewrote' : 'Can rewrite';
	const lines = [
		`\n  ${bold(verb)} ${plural(moves.length, 'import')} in ${plural(mechanical.length, 'file')}:`
	];
	for (const { hit, path } of moves) {
		lines.push(`    ${path}  ${hit.rule.from} → ${bold(hit.rule.to)}`);
		lines.push(dim(`      ${hit.rule.because}`));
	}
	const notes = [...new Set(mechanical.flatMap((edit) => edit.notes))];
	if (notes.length > 0) {
		lines.push(`\n  ${warn('Check these after the rewrite:')}`);
		for (const note of notes) lines.push(dim(`    - ${note}`));
	}

	return lines.join('\n');
};

const renderManual = (plan: ReturnType<typeof scanProject>) => {
	const { manual } = plan.codemods;
	if (manual.length === 0) return '';
	const lines = [
		`\n  ${bold(String(manual.length))} framework ${manual.length === 1 ? 'module needs' : 'modules need'} a person. No command can do these:`
	];
	for (const finding of manual) {
		lines.push(
			`    ${bold(finding.rule.from)} ${dim(`(${finding.files.slice(0, SHOWN_FILES).join(', ')}${finding.files.length > SHOWN_FILES ? `, +${finding.files.length - SHOWN_FILES} more` : ''})`)}`
		);
		lines.push(dim(`      ${finding.rule.reason}`));
		lines.push(`      ${finding.rule.instruction}`);
	}

	return lines.join('\n');
};

/** Report what a migration would involve. Rewrites the mechanical imports
 *  only when asked with `--apply`; everything else is a report. */
export const migrate = (root = process.cwd(), write = false) => {
	const plan = scanProject(root);
	const pending = plan.codemods.mechanical.length > 0;
	/* Written before anything is printed, so the report cannot claim a
	 * rewrite that failed. */
	const result =
		write && pending ? applyCodemodPlan(root, plan.codemods) : null;

	console.log(renderDetection(plan));
	const mechanical = renderMechanical(plan, result !== null);
	if (mechanical) console.log(mechanical);
	const manual = renderManual(plan);
	if (manual) console.log(manual);
	console.log(renderSubstitutions(plan));

	if (result) {
		console.log(
			`\n  ${bold(`Wrote ${plural(result.applied.length, 'file')}.`)}`
		);
		for (const failure of result.failed)
			console.log(
				warn(`    could not write ${failure.path}: ${failure.reason}`)
			);
	} else if (pending) {
		console.log(
			dim(
				'\n  Nothing was written. Re-run with --apply to make the rewrites above.'
			)
		);
	}
	console.log('');
};

/* `absolute migrate` — the human-facing rendering of the migration engine.
 *
 * All the judgement lives in `src/migrate`, which returns data and never
 * prints. This file only formats. That split is what lets the Studio AI
 * tools hand the same values to a model as JSON instead of scraping text
 * out of a terminal. */

import { CONFIDENT } from '../../migrate/detect';
import { scanProject } from '../../migrate/scan';
import { colors } from '../tuiPrimitives';

const PERCENT = 100;

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
	lines.push(
		dim(
			'\n  Nothing was changed. This command only reports; apply the swaps yourself\n  or let Studio propose them as a reviewable diff.'
		)
	);

	return lines.join('\n');
};

/** Report what a migration would involve, without changing anything. */
export const migrate = (root = process.cwd()) => {
	const plan = scanProject(root);
	console.log(renderDetection(plan));
	console.log(renderSubstitutions(plan));
	console.log('');
};

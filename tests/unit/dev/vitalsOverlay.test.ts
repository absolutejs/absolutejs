import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { materializeVitalsReporter } from '../../../src/build/vitals';
import { VITAL_THRESHOLDS } from '../../../src/core/vitalsStore';

/* The overlay itself is DOM code checked by running the dev server. What is
 * worth pinning here is everything around it that can go wrong silently:
 * that it never reaches a production bundle, that collection and sending
 * come apart in dev only, and that it does not keep its own copy of the
 * thresholds. */

let dir = '';

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), 'abs-vitals-overlay-'));
});

afterEach(async () => {
	await rm(dir, { force: true, recursive: true });
});

const reporterFor = async (isDev: boolean, sampleRate = 1) => {
	const generatedRoot = join(dir, 'generated');
	await materializeVitalsReporter({
		buildPath: join(dir, 'build'),
		config: { sampleRate },
		generatedRoot,
		isDev
	});

	return readFile(join(generatedRoot, 'vitals', 'reporter.ts'), 'utf8');
};

describe('the overlay is dev-only', () => {
	/* A debug panel on a production page is a defect, not a nuisance: it
	 * ships weight to every visitor and shows them the site's own timings. */
	test('a production reporter does not import or mount it', async () => {
		const source = await reporterFor(false);

		expect(source).not.toContain('mountVitalsOverlay');
		expect(source).not.toContain('vitalsOverlay');
		expect(source).toContain('const overlay = undefined;');
	});

	test('a dev reporter imports it from the shipped dev client', async () => {
		const source = await reporterFor(true);

		expect(source).toContain('mountVitalsOverlay');
		/* The path the bundler resolves. Posix separators, because a
		 * Windows path in an import specifier would not resolve. */
		expect(source).toMatch(
			/import \{ mountVitalsOverlay \} from "[^"]*\/dev\/client\/vitalsOverlay\.ts";/u
		);
		expect(source).not.toContain('\\dev\\client');
	});
});

describe('collecting and sending come apart in dev', () => {
	/* `sampleRate` is a production knob. An overlay blank on three reloads
	 * out of four is not a tool, so the overlay sees every load while
	 * `sampleRate` still decides what is POSTed. */
	test('a dev reporter collects whether or not the load is sampled', async () => {
		const source = await reporterFor(true, 0.1);

		expect(source).toContain('if (sampled || overlay !== undefined)');
		/* And the send is still gated, so a sampled share of 0.1 really
		 * reports a tenth of loads. */
		expect(source).toContain('if (!sampled || pending.size === 0) return;');
	});

	/* With the overlay absent the guard collapses to the sampling check, so
	 * production behaviour is what it was before the overlay existed. */
	test('a production reporter only runs for a sampled load', async () => {
		const source = await reporterFor(false, 0.25);

		expect(source).toContain('const sampled = Math.random() < 0.25;');
		expect(source).toContain('if (sampled || overlay !== undefined)');
		expect(source).toContain('const overlay = undefined;');
	});
});

describe('the thresholds have one source', () => {
	/* The overlay colours a value and the summary endpoint bands the same
	 * value. Two copies of five pairs of numbers drift, and an overlay
	 * calling a value good while the summary calls it poor is worse than no
	 * overlay — so the thresholds are serialized into the reporter from the
	 * constant the server reports with, rather than restated in the
	 * browser module. */
	test('they are injected from VITAL_THRESHOLDS', async () => {
		const source = await reporterFor(true);

		expect(source).toContain(
			`thresholds: ${JSON.stringify(VITAL_THRESHOLDS)}`
		);
	});

	/* And the overlay cannot reach for them itself. This is the packaging
	 * constraint that forced the injection: the overlay ships as
	 * `dist/dev/client/vitalsOverlay.ts`, while `src/core/` ships as
	 * bundled output and declarations — there is no `dist/core/
	 * vitalsStore.js` beside it to import.
	 *
	 * TYPE imports are caught by this too, which is the part that is easy
	 * to get wrong: the bundler erases them, so a dev build succeeds either
	 * way and a source checkout resolves them, but `scripts/build.ts`
	 * resolves every import in the published dev client and fails the build
	 * on one it cannot follow. It failed on exactly this import, after this
	 * file's first version let a type import through. `types/` is reachable
	 * from the published dev client; `src/core/` is not. */
	test('the overlay imports nothing from outside types/ and the dev client', async () => {
		const overlay = await readFile(
			join(import.meta.dir, '../../../src/dev/client/vitalsOverlay.ts'),
			'utf8'
		);
		const specifiers = [...overlay.matchAll(/from\s+'([^']+)'/gu)].map(
			(match) => match[1] ?? ''
		);
		const unreachable = specifiers.filter(
			(specifier) =>
				!specifier.startsWith('./') &&
				!specifier.startsWith('../../../types/')
		);

		expect(unreachable).toEqual([]);
	});
});

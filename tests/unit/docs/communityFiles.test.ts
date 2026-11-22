import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/* The three files GitHub looks for, and the claims in them a test can
 * check.
 *
 * All three were missing — including from `.github/` — so a researcher with
 * a vulnerability had the public issue tracker and nothing else, which is
 * the one place such a report must not go.
 *
 * What is checked here is the part that rots: a contributor guide that
 * names gate commands which have since been renamed is worse than no
 * guide, because someone follows it and concludes the project is broken.
 * The README had exactly that failure in its install step. Prose, tone and
 * policy are not asserted. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const read = (path: string) => readFileSync(join(repoRoot, path), 'utf-8');

const manifest: {
	engines?: { bun?: string };
	scripts: Record<string, string>;
} = JSON.parse(read('package.json'));

describe('community health files', () => {
	test.each([['SECURITY.md'], ['CONTRIBUTING.md'], ['CODE_OF_CONDUCT.md']])(
		'%s exists at the root, where GitHub looks for it',
		(file) => {
			expect(existsSync(join(repoRoot, file))).toBe(true);
		}
	);
});

describe('SECURITY.md', () => {
	const security = read('SECURITY.md');

	/* The whole point of the file. */
	test('tells people not to use the issue tracker, and gives a private channel', () => {
		expect(security).toMatch(/do not open a public issue/i);
		expect(security).toContain(
			'https://github.com/absolutejs/absolutejs/security'
		);
		expect(security).toContain('Report a vulnerability');
	});

	/* Private vulnerability reporting is a repository setting. Until it is
	 * enabled the button does not exist, so the file carries a route that
	 * works regardless — the same mistake as a contact link pointing at
	 * disabled Discussions. */
	test('has a fallback for when private reporting is not available', () => {
		expect(security).toMatch(/if that button is not available/i);
		expect(security).toMatch(
			/no details, no\s+\*\*reproduction\*\*|no details/i
		);
	});

	test('names the supported version honestly rather than inventing an LTS', () => {
		expect(security).toContain('0.20.0-beta');
		expect(security).toMatch(/no long-term support branch/i);
	});
});

describe('CONTRIBUTING.md', () => {
	const contributing = read('CONTRIBUTING.md');

	/* The rot that matters: a renamed script makes the guide lie. */
	test('every gate command it tells contributors to run is a real script', () => {
		const commands = [...contributing.matchAll(/bun run ([a-z:]+)/g)]
			.map((match) => match[1])
			.filter((name): name is string => name !== undefined);

		expect(commands.length).toBeGreaterThan(3);
		for (const name of new Set(commands))
			expect({
				has: Object.hasOwn(manifest.scripts, name),
				script: name
			}).toEqual({
				has: true,
				script: name
			});
	});

	test('the Bun version it states matches engines', () => {
		const required = manifest.engines?.bun?.replace(/^>=\s*/, '');

		expect(required).toBeDefined();
		expect(contributing).toContain(required ?? 'MISSING');
	});

	/* Two things a contributor cannot discover from the code, and both cost
	 * a wasted CI round when missed. */
	test('warns about the two traps this project actually has', () => {
		expect(contributing).toMatch(/must not depend on `dist\/`/i);
		expect(contributing).toContain('changelog/unreleased/');
	});

	test('routes a security report away from the issue tracker', () => {
		expect(contributing).toContain('SECURITY.md');
	});
});

describe('CODE_OF_CONDUCT.md', () => {
	const conduct = read('CODE_OF_CONDUCT.md');

	test('is the Contributor Covenant and says which version', () => {
		expect(conduct).toContain('Contributor Covenant');
		expect(conduct).toContain('version 2.1');
	});

	/* A code of conduct with no way to report anything is decoration. */
	test('gives a private reporting route', () => {
		expect(conduct).toMatch(/report .*privately|privately/i);
		expect(conduct).toContain(
			'https://github.com/absolutejs/absolutejs/security'
		);
	});
});

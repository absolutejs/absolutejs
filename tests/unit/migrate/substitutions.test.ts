import { describe, expect, test } from 'bun:test';
import {
	DEFAULT_SUBSTITUTION_RULES,
	planSubstitutions
} from '../../../src/migrate/substitutions';

const catalog: { name: string }[] = [
	{ name: '@absolutejs/auth' },
	{ name: '@absolutejs/blob' },
	{ name: '@absolutejs/queue' }
];

describe('planSubstitutions', () => {
	test('suggests a first-party equivalent for a declared dependency', () => {
		const [only] = planSubstitutions({
			catalog,
			dependencies: ['next-auth']
		});

		expect(only?.from).toBe('next-auth');
		expect(only?.to).toBe('@absolutejs/auth');
		expect(only?.rationale.length).toBeGreaterThan(0);
	});

	test('never suggests a package missing from the catalog', () => {
		// `pino` has a rule, but @absolutejs/logs is not in this catalog.
		// Recommending an import that cannot resolve is worse than silence.
		const result = planSubstitutions({
			catalog,
			dependencies: ['pino']
		});

		expect(result).toEqual([]);
	});

	test('ignores dependencies the project does not have', () => {
		expect(planSubstitutions({ catalog, dependencies: [] })).toEqual([]);
	});

	test('reports where the dependency is actually imported', () => {
		const [only] = planSubstitutions({
			catalog,
			dependencies: ['bullmq'],
			importsByPackage: { bullmq: ['src/jobs/email.ts'] }
		});

		expect(only?.usedIn).toEqual(['src/jobs/email.ts']);
	});

	test('a declared but unimported dependency is still reported', () => {
		const [only] = planSubstitutions({
			catalog,
			dependencies: ['bullmq']
		});

		// Worth knowing for a different reason: it may be dead weight.
		expect(only?.usedIn).toEqual([]);
	});

	test('the most-used dependency is ranked first', () => {
		const result = planSubstitutions({
			catalog,
			dependencies: ['next-auth', 'bullmq'],
			importsByPackage: {
				bullmq: ['src/a.ts', 'src/b.ts'],
				'next-auth': ['src/auth.ts']
			}
		});

		expect(result.map((entry) => entry.from)).toEqual([
			'bullmq',
			'next-auth'
		]);
	});

	test('callers can supply their own rules', () => {
		const [only] = planSubstitutions({
			catalog,
			dependencies: ['some-uploader'],
			rules: [
				{
					from: 'some-uploader',
					rationale: 'first-party object storage',
					to: '@absolutejs/blob'
				}
			]
		});

		expect(only?.to).toBe('@absolutejs/blob');
	});

	test('every default rule points at an @absolutejs package', () => {
		for (const rule of DEFAULT_SUBSTITUTION_RULES) {
			expect(rule.to.startsWith('@absolutejs/')).toBe(true);
			expect(rule.from.startsWith('@absolutejs/')).toBe(false);
		}
	});
});

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/* Which `@capacitor/*` packages this framework depends on, and why — a
 * question that has a wrong answer in both directions.
 *
 * Too many: `@capacitor/keyboard` and `@capacitor/network` were hard
 * dependencies this package did not import. `network` only ever appeared as
 * a version string the CLI installs into the generated app, and removing it
 * costs a consumer nothing because `@absolutejs/devices-capacitor` depends
 * on it anyway. `keyboard` IS needed to bundle the shell — the shell always
 * includes the `keyboard` capability and its provider module imports the
 * package — but provisioning installs it on demand from the adapter's
 * capability manifest (`packages: ["@capacitor/keyboard@8.0.5"]`) and
 * `assertNativePackageVersions` fails loudly when it is missing, so a
 * web-only project need not carry it.
 *
 * Too few: `browser`, `filesystem` and `preferences` are imported
 * statically by the mobile shell, which `buildShellBootstrap` bundles with
 * `Bun.build` marking only `web-vitals` external — so they must resolve
 * when the shell is BUILT. Being framework dependencies is what puts them
 * in a consuming project's lockfile without the project asking, and the
 * generated release workflow installs with a frozen `bun ci` and never runs
 * `absolute mobile init`. As peers, a project that had not declared them
 * could not acquire them during a release, and a frozen install cannot
 * repair itself.
 *
 * This test exists because both mistakes look like tidying. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const read = (path: string) => readFileSync(join(repoRoot, path), 'utf-8');

const manifest: {
	dependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
} = JSON.parse(read('package.json'));

const capacitorIn = (field: 'dependencies' | 'peerDependencies') =>
	Object.keys(manifest[field] ?? {})
		.filter((name) => name.startsWith('@capacitor/'))
		.sort();

/** Bundled into the mobile shell, so they must resolve at build time. */
const BUNDLED = [
	'@capacitor/browser',
	'@capacitor/filesystem',
	'@capacitor/preferences'
];

describe('@capacitor dependencies', () => {
	test('exactly the three the shell bundles are dependencies', () => {
		expect(capacitorIn('dependencies')).toEqual(BUNDLED);
	});

	/* Each one is imported by a shell module, which is the whole
	 * justification — a dependency here with no import is the mistake that
	 * was removed. */
	test.each(BUNDLED)('%s is imported by a shell module', (name) => {
		const shell = `${read('src/mobile/shellBootstrap.ts')}\n${read('src/mobile/shellUpdate.ts')}`;

		expect(shell).toContain(`from '${name}'`);
	});

	test('the two this package does not import are gone, and stay gone', () => {
		for (const name of ['@capacitor/keyboard', '@capacitor/network'])
			expect(capacitorIn('dependencies')).not.toContain(name);
	});

	/* The keyboard removal is only safe while provisioning still installs
	 * the capability's own package. If that manifest entry disappears, a
	 * shell bundle would fail to resolve it and nothing here would carry
	 * it. */
	test('provisioning still declares the keyboard plugin it installs', async () => {
		const adapter: {
			absolutejs?: {
				devices?: {
					capabilities?: Record<string, { packages?: string[] }>;
				};
			};
		} = await Bun.file(
			join(
				repoRoot,
				'node_modules/@absolutejs/devices-capacitor/package.json'
			)
		).json();

		expect(
			adapter.absolutejs?.devices?.capabilities?.keyboard?.packages
		).toContain('@capacitor/keyboard@8.0.5');
	});

	/* The platform packages are peers on purpose: a project picks the
	 * platforms it ships, and nothing in `src/` imports them. */
	test('the platform and CLI packages remain peers', () => {
		expect(capacitorIn('peerDependencies')).toEqual([
			'@capacitor/android',
			'@capacitor/app',
			'@capacitor/cli',
			'@capacitor/core',
			'@capacitor/ios'
		]);
	});

	/* The reason has to be findable from the thing it constrains, or the
	 * next person reads three dependencies with no imports in the web code
	 * and removes them. */
	test('the reason is recorded where someone would change it', () => {
		const doc = read('docs/MOBILE_NATIVE_DEPENDENCIES.md');

		expect(doc).toContain('bun ci');
		expect(doc).toContain('mobile init');
		for (const path of [
			'src/mobile/shellBootstrap.ts',
			'src/mobile/shellUpdate.ts'
		])
			expect(read(path)).toContain('MOBILE_NATIVE_DEPENDENCIES.md');
	});
});

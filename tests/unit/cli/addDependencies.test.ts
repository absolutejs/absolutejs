import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
	FRAMEWORK_PACKAGES,
	SCAFFOLD_VERSIONS,
	frameworkDependencyNames,
	installFrameworkDependencies,
	plannedFrameworkInstall
} from '../../../src/cli/add/dependencies';
import {
	FRAMEWORK_KEYS,
	type FrameworkKey
} from '../../../src/cli/generate/frameworkKey';

// What `create-absolutejs --<framework>` writes into package.json for each
// framework (create-absolutejs 0.20.17, src/versions.ts +
// generatePackageJson.ts). `absolute add <framework>` must install exactly
// this, so a project that adds a framework later matches one scaffolded with it.
type PackageJsonSections = {
	dependencies: Record<string, string>;
	devDependencies: Record<string, string>;
};

type InstallCall = { dev: boolean; specs: string[] };

const SCAFFOLD_EXPECTED: Record<FrameworkKey, PackageJsonSections> = {
	angular: {
		dependencies: {
			'@angular/common': '21.2.24',
			'@angular/compiler': '21.2.24',
			'@angular/compiler-cli': '21.2.24',
			'@angular/core': '21.2.24',
			'@angular/platform-browser': '21.2.24',
			'@angular/platform-server': '21.2.24',
			'@angular/router': '21.2.24',
			'@angular/ssr': '21.2.24'
		},
		devDependencies: {}
	},
	html: { dependencies: {}, devDependencies: {} },
	htmx: {
		dependencies: { '@absolutejs/scoped-state': '0.3.1' },
		devDependencies: {}
	},
	react: {
		dependencies: { react: '19.3.0', 'react-dom': '19.3.0' },
		devDependencies: { '@types/react': '19.3.0', 'react-refresh': '0.19.0' }
	},
	svelte: {
		dependencies: { svelte: '5.57.1' },
		devDependencies: { 'svelte-check': '4.7.8', svelte2tsx: '0.7.63' }
	},
	vue: {
		dependencies: { vue: '3.5.43', 'vue-router': '4.6.4' },
		devDependencies: { 'vue-tsc': '3.3.14' }
	}
};

const toRecord = (specs: string[]) =>
	Object.fromEntries(
		specs.map((spec) => {
			const at = spec.lastIndexOf('@');

			return [spec.slice(0, at), spec.slice(at + 1)];
		})
	);

const plannedRecords = (framework: FrameworkKey) => {
	const planned = plannedFrameworkInstall(framework);

	return {
		dependencies: toRecord(planned.dependencies),
		devDependencies: toRecord(planned.devDependencies)
	};
};

describe('absolute add framework dependencies', () => {
	for (const framework of FRAMEWORK_KEYS) {
		test(`${framework} installs the scaffold's packages and versions`, () => {
			expect(plannedRecords(framework)).toEqual(
				SCAFFOLD_EXPECTED[framework]
			);
		});
	}

	test('vue installs vue-router, which a page exporting routes needs', () => {
		expect(plannedFrameworkInstall('vue').dependencies).toContain(
			'vue-router@4.6.4'
		);
	});

	test('react installs the scaffold React, not an older pin', () => {
		expect(plannedFrameworkInstall('react').dependencies).toEqual([
			'react@19.3.0',
			'react-dom@19.3.0'
		]);
	});

	test('the installer receives the planned lists, deps then devDeps', () => {
		const calls: InstallCall[] = [];
		const result = installFrameworkDependencies(
			'/nowhere',
			'vue',
			(_cwd, specs, dev) => {
				calls.push({ dev, specs });

				return true;
			}
		);
		expect(calls).toEqual([
			{ dev: false, specs: ['vue@3.5.43', 'vue-router@4.6.4'] },
			{ dev: true, specs: ['vue-tsc@3.3.14'] }
		]);
		expect(result).toEqual({
			ok: true,
			specs: ['vue@3.5.43', 'vue-router@4.6.4', 'vue-tsc@3.3.14']
		});
	});

	test('a failed install is reported', () => {
		const result = installFrameworkDependencies(
			'/nowhere',
			'react',
			() => false
		);
		expect(result.ok).toBe(false);
	});

	test('remove --prune uninstalls exactly what add installs', () => {
		for (const framework of FRAMEWORK_KEYS) {
			const planned = plannedRecords(framework);
			const names: string[] = frameworkDependencyNames(framework);
			expect(names.sort()).toEqual(
				[
					...Object.keys(planned.dependencies),
					...Object.keys(planned.devDependencies)
				].sort()
			);
		}
	});

	test('every pinned version is used by some framework', () => {
		const used = new Set(
			FRAMEWORK_KEYS.flatMap((framework) => [
				...FRAMEWORK_PACKAGES[framework].dependencies,
				...FRAMEWORK_PACKAGES[framework].devDependencies
			])
		);
		expect(Object.keys(SCAFFOLD_VERSIONS).sort()).toEqual([...used].sort());
	});
});

// When a create-absolutejs checkout is reachable (CREATE_ABSOLUTEJS_DIR, or a
// `create-absolutejs` directory beside any ancestor of this repo), compare
// against the scaffold's own source so the two cannot drift silently.
const findScaffoldCheckout = () => {
	const fromEnv = process.env.CREATE_ABSOLUTEJS_DIR;
	if (fromEnv) return existsSync(join(fromEnv, 'src')) ? fromEnv : null;
	let dir = resolve(import.meta.dir, '..', '..', '..');
	while (dirname(dir) !== dir) {
		const candidate = join(dirname(dir), 'create-absolutejs');
		if (existsSync(join(candidate, 'src', 'versions.ts'))) return candidate;
		dir = dirname(dir);
	}

	return null;
};

const FLAG_FRAMEWORK: Record<string, FrameworkKey> = {
	Angular: 'angular',
	Html: 'html',
	Htmx: 'htmx',
	React: 'react',
	Svelte: 'svelte',
	Vue: 'vue'
};

const scaffoldPackageSets = (source: string) => {
	const sets: Record<FrameworkKey, Set<string>> = {
		angular: new Set(),
		html: new Set(),
		htmx: new Set(),
		react: new Set(),
		svelte: new Set(),
		vue: new Set()
	};
	const blocks = source.matchAll(
		/if \(flags\.requires(\w+)\)\s*(\{[^}]*\}|[^\n]*;)/g
	);
	for (const [, flag = '', body = ''] of blocks) {
		const framework = FLAG_FRAMEWORK[flag];
		if (!framework) continue;
		for (const [, name = ''] of body.matchAll(
			/packageNames\.add\('([^']+)'\)/g
		))
			sets[framework].add(name);
	}

	return sets;
};

const scaffoldCheckout = findScaffoldCheckout();

describe.skipIf(scaffoldCheckout === null)(
	'absolute add matches the create-absolutejs checkout',
	() => {
		const root = scaffoldCheckout ?? '';

		test('same packages per framework, in the same package.json section', () => {
			const source = readFileSync(
				join(
					root,
					'src',
					'generators',
					'configurations',
					'generatePackageJson.ts'
				),
				'utf-8'
			);
			const sets = scaffoldPackageSets(source);
			const devNames = new Set(
				[...source.matchAll(/devDependencies\['([^']+)'\]/g)].map(
					([, name]) => name
				)
			);
			for (const framework of FRAMEWORK_KEYS) {
				const names = [...sets[framework]];
				expect({
					dependencies: names
						.filter((name) => !devNames.has(name))
						.sort(),
					devDependencies: names
						.filter((name) => devNames.has(name))
						.sort()
				}).toEqual({
					dependencies: [
						...FRAMEWORK_PACKAGES[framework].dependencies
					].sort(),
					devDependencies: [
						...FRAMEWORK_PACKAGES[framework].devDependencies
					].sort()
				});
			}
		});

		test('same versions as the scaffold versions table', async () => {
			const { versions }: { versions: Record<string, string> } =
				await import(join(root, 'src', 'versions.ts'));
			for (const [name, version] of Object.entries(SCAFFOLD_VERSIONS))
				expect({ name, version: versions[name] }).toEqual({
					name,
					version
				});
		});
	}
);

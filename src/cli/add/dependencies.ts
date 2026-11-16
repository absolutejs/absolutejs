import type { FrameworkKey } from '../generate/frameworkKey';

// The framework packages a project needs, shared by `absolute add <framework>`
// (installs them) and `absolute remove <framework> --prune` (uninstalls them).
//
// This mirrors the create-absolutejs scaffold, which is the reference project
// shape: SCAFFOLD_VERSIONS copies the framework entries of its
// `src/versions.ts`, and FRAMEWORK_PACKAGES copies the per-framework package
// lists of its `src/generators/configurations/generatePackageJson.ts`. A
// project made with `absolute add vue` therefore ends up with the same
// packages and versions as one scaffolded with `--vue`. Update both together;
// tests/unit/cli/addDependencies.test.ts pins this table and, when a
// create-absolutejs checkout sits next to this repo, compares it against the
// scaffold's own files. Bundled with the CLI so `absolute add` installs
// known-good versions without asking the registry what `latest` is.

export const SCAFFOLD_VERSIONS = {
	'@absolutejs/scoped-state': '0.3.1',
	'@angular/common': '21.2.24',
	'@angular/compiler': '21.2.24',
	'@angular/compiler-cli': '21.2.24',
	'@angular/core': '21.2.24',
	'@angular/platform-browser': '21.2.24',
	'@angular/platform-server': '21.2.24',
	'@angular/router': '21.2.24',
	'@angular/ssr': '21.2.24',
	'@types/react': '19.3.0',
	react: '19.3.0',
	'react-dom': '19.3.0',
	'react-refresh': '0.19.0',
	svelte: '5.57.1',
	'svelte-check': '4.7.8',
	svelte2tsx: '0.7.63',
	vue: '3.5.43',
	/* The version create-absolutejs scaffolds; 5 is supported too. */
	'vue-router': '4.6.4',
	'vue-tsc': '3.3.14'
} as const;

type ScaffoldPackage = keyof typeof SCAFFOLD_VERSIONS;

type FrameworkPackages = {
	dependencies: readonly ScaffoldPackage[];
	devDependencies: readonly ScaffoldPackage[];
};

export const FRAMEWORK_PACKAGES: Record<FrameworkKey, FrameworkPackages> = {
	angular: {
		dependencies: [
			'@angular/common',
			'@angular/compiler',
			'@angular/compiler-cli',
			'@angular/core',
			'@angular/platform-browser',
			'@angular/platform-server',
			/* The auto router (a page that exports `routes`) needs it. */
			'@angular/router',
			'@angular/ssr'
		],
		devDependencies: []
	},
	html: { dependencies: [], devDependencies: [] },
	htmx: { dependencies: ['@absolutejs/scoped-state'], devDependencies: [] },
	react: {
		dependencies: ['react', 'react-dom'],
		devDependencies: ['@types/react', 'react-refresh']
	},
	svelte: {
		dependencies: ['svelte'],
		/* `absolute typecheck` generates component declarations with
		   svelte2tsx and checks .svelte files with svelte-check. */
		devDependencies: ['svelte2tsx', 'svelte-check']
	},
	vue: {
		/* The auto router (a page that exports `routes`) needs vue-router. */
		dependencies: ['vue', 'vue-router'],
		devDependencies: ['vue-tsc']
	}
};

const toSpecs = (names: readonly ScaffoldPackage[]) =>
	names.map((name) => `${name}@${SCAFFOLD_VERSIONS[name]}`);

/** The `bun add` specs `absolute add <framework>` installs, split by section. */
export const plannedFrameworkInstall = (framework: FrameworkKey) => {
	const packages = FRAMEWORK_PACKAGES[framework];

	return {
		dependencies: toSpecs(packages.dependencies),
		devDependencies: toSpecs(packages.devDependencies)
	};
};

type BunAddRunner = (cwd: string, specs: string[], dev: boolean) => boolean;

const runBunAdd: BunAddRunner = (cwd, specs, dev) => {
	if (specs.length === 0) return true;
	const flags = dev ? ['--dev'] : [];
	const result = Bun.spawnSync(['bun', 'add', ...flags, ...specs], {
		cwd,
		stderr: 'inherit',
		stdout: 'inherit'
	});

	return result.success;
};

export const frameworkDependencyNames = (framework: FrameworkKey) => {
	const packages = FRAMEWORK_PACKAGES[framework];

	return [...packages.dependencies, ...packages.devDependencies];
};

// Installs a framework's pinned deps + devDeps via `bun add`. Returns the full
// spec list and whether the install succeeded (best-effort — scaffolding
// continues even if the registry is unreachable).
export const installFrameworkDependencies = (
	cwd: string,
	framework: FrameworkKey,
	run: BunAddRunner = runBunAdd
) => {
	const { dependencies, devDependencies } =
		plannedFrameworkInstall(framework);
	const specs = [...dependencies, ...devDependencies];
	if (specs.length === 0) return { ok: true, specs };
	const succeeded =
		run(cwd, dependencies, false) && run(cwd, devDependencies, true);

	return { ok: succeeded, specs };
};

// Generic `bun add` for an explicit spec list — used by integrations (Elysia
// plugins) which aren't framework-pinned. Returns whether the install succeeded.
export const installPackages = (cwd: string, specs: string[], dev = false) =>
	runBunAdd(cwd, specs, dev);

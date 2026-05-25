import type { FrameworkKey } from '../generate/frameworkKey';

// Version-aligned dependency manifest, pinned to what the AbsoluteJS examples are
// tested against (Angular runs zoneless, so no zone.js; Vue's compiler-sfc and
// htmx scoped-state come transitively / from @absolutejs/absolute). Bundled with
// the CLI so `absolute add` installs known-good versions offline-of-the-registry.

type FrameworkDependencies = {
	dependencies: Record<string, string>;
	devDependencies: Record<string, string>;
};

export const FRAMEWORK_DEPENDENCIES: Record<
	FrameworkKey,
	FrameworkDependencies
> = {
	angular: {
		dependencies: {
			'@angular/common': '^21.0.0',
			'@angular/compiler': '^21.0.0',
			'@angular/compiler-cli': '^21.0.0',
			'@angular/core': '^21.0.0',
			'@angular/platform-browser': '^21.0.0',
			'@angular/platform-server': '^21.0.0',
			'@angular/ssr': '^21.0.0'
		},
		devDependencies: {}
	},
	html: { dependencies: {}, devDependencies: {} },
	htmx: { dependencies: {}, devDependencies: {} },
	react: {
		dependencies: { react: '19.2.4', 'react-dom': '19.2.4' },
		devDependencies: {
			'@types/react': '^19.2.14',
			'@types/react-dom': '^19.2.3'
		}
	},
	svelte: {
		dependencies: { svelte: '5.55.0' },
		devDependencies: { 'svelte-check': '^4.4.5' }
	},
	vue: {
		dependencies: { vue: '3.5.27' },
		devDependencies: { 'vue-tsc': '^3.2.6' }
	}
};

const toSpecs = (record: Record<string, string>) =>
	Object.entries(record).map(([name, version]) => `${name}@${version}`);

const runBunAdd = (cwd: string, specs: string[], dev: boolean) => {
	if (specs.length === 0) return true;
	const flags = dev ? ['--dev'] : [];
	const result = Bun.spawnSync(['bun', 'add', ...flags, ...specs], {
		cwd,
		stderr: 'inherit',
		stdout: 'inherit'
	});

	return result.success;
};

// Installs a framework's pinned deps + devDeps via `bun add`. Returns the full
// spec list and whether the install succeeded (best-effort — scaffolding
// continues even if the registry is unreachable).
export const frameworkDependencyNames = (framework: FrameworkKey) => {
	const manifest = FRAMEWORK_DEPENDENCIES[framework];

	return [
		...Object.keys(manifest.dependencies),
		...Object.keys(manifest.devDependencies)
	];
};
export const installFrameworkDependencies = (
	cwd: string,
	framework: FrameworkKey
) => {
	const manifest = FRAMEWORK_DEPENDENCIES[framework];
	const deps = toSpecs(manifest.dependencies);
	const devDeps = toSpecs(manifest.devDependencies);
	const specs = [...deps, ...devDeps];
	if (specs.length === 0) return { ok: true, specs };
	const succeeded =
		runBunAdd(cwd, deps, false) && runBunAdd(cwd, devDeps, true);

	return { ok: succeeded, specs };
};
